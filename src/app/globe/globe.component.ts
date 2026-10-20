import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewEncapsulation,
  effect,
  inject,
  input,
  output,
  viewChild
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { ThemeService } from '@kmd/design-system';
import { BalticData, Basin, Poly } from '../core/data/baltic.model';
import { Nutrient, RAMP_TOKENS, specClass } from '../core/data/nutrients';

export interface GlobeHover {
  id: number;
  x: number;
  y: number;
}

const R = 5;
const DEG = Math.PI / 180;
const RIVER_WIDTH = [0.5, 0.85, 1.4, 2.2, 3.2];
const RIVER_OPACITY = [0.3, 0.5, 0.75, 0.9, 0.95];
const COLUMN_MAX_HEIGHT = 0.8;
const COLUMN_RADIUS = 0.014;
/**
 * The camera looks this far north of its nadir (× altitude), pitching the view ~24° so the
 * load columns are seen at an angle instead of head-on.
 */
const PITCH = 0.45;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lonLatToVec(lon: number, lat: number, r = R, out = new THREE.Vector3()) {
  const phi = ((lon + 180) / 360) * Math.PI * 2;
  const th = (90 - lat) * DEG;
  return out.set(-r * Math.cos(phi) * Math.sin(th), r * Math.cos(th), r * Math.sin(phi) * Math.sin(th));
}

function vecToLonLat(p: THREE.Vector3): [number, number] {
  const v = p.clone().normalize();
  const lat = 90 - Math.acos(clamp(v.y, -1, 1)) / DEG;
  let lon = Math.atan2(v.z, -v.x) / DEG - 180;
  if (lon < -180) lon += 360;
  return [lon, lat];
}

function inRing(r: Float32Array, x: number, y: number) {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

interface Label {
  el: HTMLDivElement;
  p: THREE.Vector3;
  maxDist: number;
  w: number;
  h: number;
}

interface RiverLayer {
  geo: LineSegmentsGeometry;
  mat: LineMaterial;
  segBasin: Uint16Array;
  col: Float32Array;
  nseg: number;
}

/**
 * Three.js globe of the Baltic drainage basin: catchments shaded by area-specific nutrient load,
 * the HydroRIVERS network, and 3D columns at river mouths proportional to the annual load.
 */
@Component({
  selector: 'app-globe',
  standalone: true,
  template: `
    <canvas #canvas class="globe__canvas"></canvas>
    <div #labels class="globe__labels" aria-hidden="true"></div>
  `,
  styleUrl: './globe.component.scss',
  encapsulation: ViewEncapsulation.None,
  host: { class: 'globe' }
})
export class GlobeComponent implements AfterViewInit, OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly theme = inject(ThemeService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly data = input.required<BalticData>();
  readonly nutrient = input<Nutrient>('n');
  readonly selected = input<number>(-1);
  readonly showRivers = input(true);
  readonly showColumns = input(true);
  readonly showBorders = input(true);
  readonly showLabels = input(true);
  /** Localized label for a river basin (dataset names are Polish). */
  readonly basinLabel = input<(b: Basin) => string>(b => b.name ?? '');
  readonly subNames = input<string[]>([]);

  readonly pick = output<number>();
  readonly hover = output<GlobeHover | null>();

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly labelsRef = viewChild.required<ElementRef<HTMLDivElement>>('labels');

  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.005, 400);
  private controls!: OrbitControls;
  private globe!: THREE.Mesh;
  private rivers = new THREE.Group();
  private riverLayers: RiverLayer[] = [];
  private columns!: THREE.InstancedMesh;
  private columnBasins: number[] = [];
  private columnHeights = new Float32Array(0);
  private columnTargets = new Float32Array(0);
  private columnRadius = new Float32Array(0);
  private columnRadiusTargets = new Float32Array(0);
  private columnBase: THREE.Matrix4[] = [];
  private columnsDirty = true;
  private sun = new THREE.DirectionalLight(0xffffff, 1.1);

  private regionCanvas = document.createElement('canvas');
  private regionCtx!: CanvasRenderingContext2D;
  private regionTex!: THREE.CanvasTexture;
  private RW = 0;
  private RH = 0;

  private labels: Label[] = [];
  private fly: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
  private raf = 0;
  private clock = new THREE.Clock();
  private resizeObs?: ResizeObserver;
  private ready = false;
  private down: [number, number] | null = null;
  private lastHover = -2;
  private ramp: Record<Nutrient, THREE.Color[]> = { n: [], p: [] };
  private colors: Record<string, string> = {};

  constructor() {
    effect(() => {
      this.nutrient();
      this.selected();
      this.showBorders();
      if (!this.ready) return;
      this.drawRegion();
      this.colorRivers();
      this.updateColumnTargets();
    });
    effect(() => {
      const v = this.showRivers();
      this.rivers.visible = v;
    });
    effect(() => {
      const v = this.showColumns();
      if (this.columns) this.columns.visible = v;
    });
    effect(() => {
      this.basinLabel();
      this.subNames();
      if (this.ready) this.buildLabels();
    });
  }

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => this.init());
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.controls?.dispose();
    this.renderer?.dispose();
  }

  /** Smoothly moves the camera over a basin. */
  flyToBasin(id: number) {
    const b = this.data().basins[id];
    if (!b) return;
    // Stay far enough back that the basin's own load column fits in the frame.
    const dist = clamp(R + 0.6 + Math.sqrt(b.kind === 'basin' ? b.area : 400) / 260, R + 0.8, R + 3.4);
    const target = b.mouth ? [lerp(b.cen[0], b.mouth[0], 0.35), lerp(b.cen[1], b.mouth[1], 0.35)] : b.cen;
    this.fly = { from: this.camera.position.clone(), to: this.cameraFor(target[0], target[1], dist), t: 0 };
  }

  /** Camera position (south of the target) from which the pitched view centres on lon/lat. */
  private cameraFor(lon: number, lat: number, dist: number, out = new THREE.Vector3()) {
    const southDeg = ((dist - R) * PITCH) / R / DEG;
    return lonLatToVec(lon, clamp(lat - southDeg, -80, 80), dist, out);
  }

  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly look = new THREE.Vector3();
  private readonly north = new THREE.Vector3();

  /** Re-aims the camera north of its nadir after OrbitControls has pointed it at the globe centre. */
  private applyPitch() {
    const dir = this.look.copy(this.camera.position).normalize();
    const alt = this.camera.position.length() - R;
    this.north.copy(this.up).addScaledVector(dir, -dir.dot(this.up));
    if (this.north.lengthSq() < 1e-6) return;
    this.north.normalize();
    this.look.multiplyScalar(R).addScaledVector(this.north, alt * PITCH);
    this.camera.lookAt(this.look);
  }

  // ─── setup ────────────────────────────────────────────────────────────────

  private readColors() {
    const tok = (k: string, fb: string) => this.theme.getTokenColor(k, fb);
    this.colors = {
      bg: tok('globe-bg', '#f5f7fb'),
      ocean: tok('primary-100', '#dbeafe'),
      lake: tok('primary-200', '#bfdbfe'),
      land: tok('globe-land-fill', '#cfd8e3'),
      coast: tok('neutral-200', '#e2e8f0'),
      river: tok('info-600', '#0284c7'),
      riverDim: tok('neutral-400', '#94a3b8'),
      ink: tok('neutral-900', '#0f172a'),
      inkSoft: tok('neutral-700', '#334155'),
      border: tok('neutral-600', '#475569'),
      halo: tok('primary-300', '#93c5fd')
    };
    for (const n of ['n', 'p'] as Nutrient[]) {
      this.ramp[n] = RAMP_TOKENS[n].map(k => new THREE.Color(tok(k, '#888888')));
    }
  }

  private init() {
    const data = this.data();
    const canvas = this.canvasRef().nativeElement;
    this.readColors();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(this.colors['bg']);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = R + 0.12;
    this.controls.maxDistance = 40;

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    this.scene.add(this.sun);

    this.buildWorld(data);
    this.buildRegion(data);
    this.buildHalo();
    this.buildRivers(data);
    this.buildColumns(data);

    this.ready = true;
    this.drawRegion();
    this.colorRivers();
    this.updateColumnTargets();
    this.columnHeights.set(this.columnTargets);
    this.columnRadius.set(this.columnRadiusTargets);
    this.columnsDirty = true;
    this.rivers.visible = this.showRivers();
    this.columns.visible = this.showColumns();
    this.buildLabels();

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.host.nativeElement);
    this.resize();
    const w = this.host.nativeElement.clientWidth, h = this.host.nativeElement.clientHeight;
    this.cameraFor(20, 59, w / Math.max(h, 1) < 0.9 ? R + 4.6 : R + 3.2, this.camera.position);
    this.controls.update();

    this.bindPointer(canvas);
    this.frame();
  }

  private buildWorld(data: BalticData) {
    const wc = document.createElement('canvas');
    wc.width = 4096; wc.height = 2048;
    const x = wc.getContext('2d')!;
    x.fillStyle = this.colors['ocean']; x.fillRect(0, 0, 4096, 2048);
    x.fillStyle = this.colors['land'];
    for (const poly of data.world) {
      x.beginPath();
      for (const ring of poly) {
        for (let k = 0; k < ring.length; k += 2) {
          const px = ((ring[k] + 180) / 360) * 4096, py = ((90 - ring[k + 1]) / 180) * 2048;
          k ? x.lineTo(px, py) : x.moveTo(px, py);
        }
        x.closePath();
      }
      x.fill('evenodd');
    }
    const tex = new THREE.CanvasTexture(wc);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 64), new THREE.MeshBasicMaterial({ map: tex }));
    this.scene.add(this.globe);
  }

  private buildRegion(data: BalticData) {
    const [LON0, LON1, LAT0, LAT1] = data.bbox;
    this.RW = Math.min(this.renderer.capabilities.maxTextureSize, 6144);
    this.RH = Math.round(((this.RW * (LAT1 - LAT0)) / (LON1 - LON0) / Math.cos(59 * DEG)) * 0.62);
    this.regionCanvas.width = this.RW;
    this.regionCanvas.height = this.RH;
    this.regionCtx = this.regionCanvas.getContext('2d')!;
    this.regionTex = new THREE.CanvasTexture(this.regionCanvas);
    this.regionTex.colorSpace = THREE.SRGBColorSpace;
    this.regionTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const patch = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.0004, 160, 120, (LON0 + 180) * DEG, (LON1 - LON0) * DEG, (90 - LAT1) * DEG, (LAT1 - LAT0) * DEG),
      new THREE.MeshBasicMaterial({ map: this.regionTex, polygonOffset: true, polygonOffsetFactor: -1 })
    );
    this.scene.add(patch);
  }

  private buildHalo() {
    const c = new THREE.Color(this.colors['halo']);
    this.scene.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(R * 1.08, 64, 32),
        new THREE.ShaderMaterial({
          uniforms: { uColor: { value: c } },
          vertexShader:
            'varying vec3 vN;varying vec3 vV;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
          fragmentShader:
            'uniform vec3 uColor;varying vec3 vN;varying vec3 vV;void main(){float d=clamp(-dot(vN,vV),0.,1.);float i=pow(d,2.2);gl_FragColor=vec4(uColor,i*0.55);}',
          side: THREE.BackSide,
          transparent: true,
          depthWrite: false
        })
      )
    );
  }

  private buildRivers(data: BalticData) {
    this.scene.add(this.rivers);
    this.riverLayers = data.rivers.map((rc, ci) => {
      let nseg = 0;
      for (const n of rc.cnt) nseg += n - 1;
      const P = new Float32Array(nseg * 6);
      const segBasin = new Uint16Array(nseg);
      const v = new THREE.Vector3(), w = new THREE.Vector3();
      const rr = R * (1.0009 + ci * 0.00012);
      let o = 0, s = 0;
      for (let i = 0; i < rc.cnt.length; i++) {
        lonLatToVec(data.qx(rc.xy[o * 2]), data.qy(rc.xy[o * 2 + 1]), rr, v); o++;
        for (let k = 1; k < rc.cnt[i]; k++, o++) {
          lonLatToVec(data.qx(rc.xy[o * 2]), data.qy(rc.xy[o * 2 + 1]), rr, w);
          P.set([v.x, v.y, v.z, w.x, w.y, w.z], s * 6);
          segBasin[s++] = rc.g[i];
          v.copy(w);
        }
      }
      const geo = new LineSegmentsGeometry();
      geo.setPositions(P);
      const col = new Float32Array(nseg * 6);
      geo.setColors(col);
      const mat = new LineMaterial({ vertexColors: true, linewidth: RIVER_WIDTH[ci], transparent: true, opacity: RIVER_OPACITY[ci], depthWrite: ci > 0 });
      const line = new LineSegments2(geo, mat);
      line.frustumCulled = false;
      line.renderOrder = 2 + ci;
      this.rivers.add(line);
      return { geo, mat, segBasin, col, nseg };
    });
  }

  private buildColumns(data: BalticData) {
    const ids = data.basins.filter(b => b.source !== 'none' && b.mouth).map(b => b.id);
    this.columnBasins = ids;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.columns = new THREE.InstancedMesh(geo, mat, ids.length);
    this.columns.frustumCulled = false;
    this.columns.renderOrder = 10;
    this.columnHeights = new Float32Array(ids.length);
    this.columnTargets = new Float32Array(ids.length);
    this.columnRadius = new Float32Array(ids.length);
    this.columnRadiusTargets = new Float32Array(ids.length);
    const up = new THREE.Vector3(0, 1, 0);
    this.columnBase = ids.map(id => {
      const [lon, lat] = data.basins[id].mouth!;
      const p = lonLatToVec(lon, lat, R * 1.0012);
      const q = new THREE.Quaternion().setFromUnitVectors(up, p.clone().normalize());
      return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
    });
    for (let i = 0; i < ids.length; i++) this.columns.setColorAt(i, new THREE.Color());
    this.scene.add(this.columns);
  }

  // ─── styling (re-run on nutrient / selection change) ─────────────────────

  private pathPoly(poly: Poly) {
    const data = this.data();
    const [LON0, LON1, LAT0, LAT1] = data.bbox;
    const x = this.regionCtx;
    x.beginPath();
    for (const ring of poly) {
      for (let k = 0; k < ring.length; k += 2) {
        const px = ((ring[k] - LON0) / (LON1 - LON0)) * this.RW;
        const py = ((LAT1 - ring[k + 1]) / (LAT1 - LAT0)) * this.RH;
        k ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.closePath();
    }
  }

  private drawRegion() {
    const data = this.data();
    const x = this.regionCtx;
    const nut = this.nutrient();
    const sel = this.selected();
    const s = this.RW / 4096;
    const ramp = this.ramp[nut];
    const [LON0, LON1, LAT0, LAT1] = data.bbox;

    x.fillStyle = this.colors['ocean']; x.fillRect(0, 0, this.RW, this.RH);
    x.fillStyle = this.colors['land'];
    for (const p of data.land) { this.pathPoly(p); x.fill('evenodd'); }

    data.basins.forEach((b, i) => {
      x.globalAlpha = sel < 0 || sel === i ? 1 : 0.35;
      x.fillStyle = b.source === 'none' ? this.colors['coast'] : '#' + ramp[specClass(nut, b.spec[nut])].getHexString();
      this.pathPoly(data.basinPolys[i]);
      x.fill('evenodd');
    });
    x.globalAlpha = 1;

    x.fillStyle = this.colors['lake'];
    for (const p of data.lakes) { this.pathPoly(p); x.fill('evenodd'); }

    x.strokeStyle = this.colors['ink']; x.globalAlpha = 0.16; x.lineWidth = 0.9 * s;
    data.basins.forEach((b, i) => { if (b.kind === 'basin') { this.pathPoly(data.basinPolys[i]); x.stroke(); } });
    x.globalAlpha = 0.35; x.lineWidth = 1.6 * s;
    for (let k = 0; k < 6; k++) { this.pathPoly(data.outlines[k]); x.stroke(); }
    x.globalAlpha = 1;

    if (this.showBorders()) {
      x.setLineDash([7 * s, 5 * s]);
      x.strokeStyle = this.colors['border']; x.globalAlpha = 0.6; x.lineWidth = 1.3 * s;
      for (const ln of data.borders) {
        x.beginPath();
        for (let k = 0; k < ln.length; k += 2) {
          const px = ((ln[k] - LON0) / (LON1 - LON0)) * this.RW, py = ((LAT1 - ln[k + 1]) / (LAT1 - LAT0)) * this.RH;
          k ? x.lineTo(px, py) : x.moveTo(px, py);
        }
        x.stroke();
      }
      x.setLineDash([]);
      x.globalAlpha = 1;
    }

    x.strokeStyle = this.colors['inkSoft']; x.lineWidth = 2.6 * s;
    this.pathPoly(data.outlines[6]); x.stroke();

    if (sel >= 0) {
      x.strokeStyle = this.colors['ink']; x.lineWidth = 3.4 * s;
      this.pathPoly(data.basinPolys[sel]); x.stroke();
    }
    this.regionTex.needsUpdate = true;
  }

  private colorRivers() {
    const sel = this.selected();
    const on = new THREE.Color(this.colors['river']);
    const dim = new THREE.Color(this.colors['riverDim']);
    for (const layer of this.riverLayers) {
      for (let s = 0; s < layer.nseg; s++) {
        const c = sel >= 0 && layer.segBasin[s] !== sel ? dim : on;
        const o = s * 6;
        layer.col[o] = layer.col[o + 3] = c.r;
        layer.col[o + 1] = layer.col[o + 4] = c.g;
        layer.col[o + 2] = layer.col[o + 5] = c.b;
      }
      const attr = layer.geo.attributes['instanceColorStart'] as THREE.InterleavedBufferAttribute;
      (attr.data.array as Float32Array).set(layer.col);
      attr.data.needsUpdate = true;
    }
  }

  private updateColumnTargets() {
    const data = this.data();
    const nut = this.nutrient();
    const sel = this.selected();
    const max = Math.max(...this.columnBasins.map(id => data.basins[id].load[nut]));
    const ramp = this.ramp[nut];
    const strong = ramp[ramp.length - 2];
    const faded = ramp[2];
    const ink = new THREE.Color(this.colors['ink']);
    this.columnBasins.forEach((id, i) => {
      const f = data.basins[id].load[nut] / max;
      this.columnTargets[i] = Math.max(0.002, COLUMN_MAX_HEIGHT * f);
      this.columnRadiusTargets[i] = 0.2 + 0.8 * Math.sqrt(f);
      this.columns.setColorAt(i, sel < 0 ? strong : id === sel ? ink : faded);
    });
    if (this.columns.instanceColor) this.columns.instanceColor.needsUpdate = true;
    this.columnsDirty = true;
  }

  private writeColumnMatrices() {
    const m = new THREE.Matrix4();
    const sc = new THREE.Matrix4();
    const alt = this.camera.position.length() - R;
    const rad = COLUMN_RADIUS * clamp(alt / 3.4, 0.25, 1.4);
    for (let i = 0; i < this.columnBasins.length; i++) {
      const r = rad * this.columnRadius[i];
      sc.makeScale(r, this.columnHeights[i], r);
      m.multiplyMatrices(this.columnBase[i], sc);
      this.columns.setMatrixAt(i, m);
    }
    this.columns.instanceMatrix.needsUpdate = true;
  }

  // ─── labels ───────────────────────────────────────────────────────────────

  private buildLabels() {
    const data = this.data();
    const root = this.labelsRef().nativeElement;
    root.textContent = '';
    this.labels = [];
    const label = this.basinLabel();
    const mk = (text: string, cls: string, lon: number, lat: number, maxDist: number) => {
      const el = document.createElement('div');
      el.className = 'globe-label ' + cls;
      el.textContent = text;
      root.appendChild(el);
      this.labels.push({ el, p: lonLatToVec(lon, lat, R * 1.002), maxDist, w: 0, h: 16 });
    };
    this.subNames().forEach((name, i) => mk(name, 'globe-label--sea', data.subs[i].lbl[0], data.subs[i].lbl[1], 99));
    data.basins
      .filter(b => b.kind === 'basin' && b.name && b.lbl)
      .sort((a, b) => b.load.n - a.load.n)
      .forEach(b => {
        const big = b.area > 40000;
        mk(label(b).replace(/ \(.+\)$/, ''), 'globe-label--river' + (big ? ' globe-label--big' : ''), b.lbl![0], b.lbl![1], big ? 99 : b.area > 15000 ? R + 5 : R + 2.6);
      });
    for (const L of this.labels) L.w = L.el.offsetWidth || L.el.textContent!.length * 7;
  }

  private updateLabels(w: number, h: number) {
    const show = this.showLabels();
    const dist = this.camera.position.length();
    const camDir = this.camera.position.clone().normalize();
    const tv = new THREE.Vector3();
    const placed: number[][] = [];
    for (const L of this.labels) {
      const f = tv.copy(L.p).normalize().dot(camDir);
      if (!show || dist > L.maxDist || f < 0.25) { L.el.style.opacity = '0'; continue; }
      tv.copy(L.p).project(this.camera);
      const x = ((tv.x + 1) / 2) * w, y = ((1 - tv.y) / 2) * h;
      const bx = [x - L.w / 2 - 3, x + L.w / 2 + 3, y - L.h / 2 - 2, y + L.h / 2 + 2];
      if (x < 0 || x > w || y < 0 || y > h || placed.some(p => p[0] < bx[1] && bx[0] < p[1] && p[2] < bx[3] && bx[2] < p[3])) {
        L.el.style.opacity = '0';
        continue;
      }
      placed.push(bx);
      L.el.style.opacity = '1';
      L.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
    }
  }

  // ─── picking ──────────────────────────────────────────────────────────────

  private basinAt(lon: number, lat: number): number {
    const data = this.data();
    const [LON0, LON1, LAT0, LAT1] = data.bbox;
    if (lon < LON0 || lon > LON1 || lat < LAT0 || lat > LAT1) return -1;
    for (const b of data.basins) {
      if (lon < b.bb[0] || lon > b.bb[1] || lat < b.bb[2] || lat > b.bb[3]) continue;
      let inside = false;
      for (const ring of data.basinPolys[b.id]) if (inRing(ring, lon, lat)) inside = !inside;
      if (inside) return b.id;
    }
    return -1;
  }

  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  private pickAt(clientX: number, clientY: number): number {
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hitGlobe = this.ray.intersectObject(this.globe)[0];
    if (this.columns.visible) {
      const hitCol = this.ray.intersectObject(this.columns)[0];
      if (hitCol && hitCol.instanceId !== undefined && (!hitGlobe || hitCol.distance <= hitGlobe.distance + 1e-3)) {
        return this.columnBasins[hitCol.instanceId];
      }
    }
    if (!hitGlobe) return -1;
    const [lon, lat] = vecToLonLat(hitGlobe.point);
    return this.basinAt(lon, lat);
  }

  private bindPointer(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', e => { this.down = [e.clientX, e.clientY]; this.fly = null; });
    canvas.addEventListener('pointerup', e => {
      if (!this.down) return;
      const moved = Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]);
      this.down = null;
      if (moved > 6) return;
      const id = this.pickAt(e.clientX, e.clientY);
      this.zone.run(() => this.pick.emit(id));
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || e.buttons) { this.emitHover(null); return; }
      const id = this.pickAt(e.clientX, e.clientY);
      canvas.style.cursor = id >= 0 ? 'pointer' : '';
      this.emitHover(id >= 0 ? { id, x: e.clientX, y: e.clientY } : null);
    });
    canvas.addEventListener('pointerleave', () => this.emitHover(null));
  }

  private emitHover(h: GlobeHover | null) {
    if (!h && this.lastHover === -1) return;
    this.lastHover = h ? h.id : -1;
    this.zone.run(() => this.hover.emit(h));
  }

  // ─── loop ─────────────────────────────────────────────────────────────────

  private resize() {
    const el = this.host.nativeElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the focus clear of the left list panel (desktop) or the bottom dock (portrait).
    if (w / h < 0.9) this.camera.setViewOffset(w, h, 0, h * 0.24, w, h);
    else if (w > 960) this.camera.setViewOffset(w, h, -Math.min(170, w * 0.11), h * 0.06, w, h);
    else this.camera.setViewOffset(w, h, 0, h * 0.08, w, h);
    this.camera.updateProjectionMatrix();
    for (const l of this.riverLayers) l.mat.resolution.set(w, h);
  }

  private lastAlt = -1;

  private frame = () => {
    const rawDt = this.clock.getDelta();
    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + Math.min(rawDt, 0.25) / 1.1);
      const e = 1 - Math.pow(1 - this.fly.t, 3);
      const a = this.fly.from.clone().normalize(), b = this.fly.to.clone().normalize();
      const d = lerp(this.fly.from.length(), this.fly.to.length(), e);
      this.camera.position.copy(a.lerp(b, e).normalize().multiplyScalar(d));
      if (this.fly.t >= 1) this.fly = null;
    }
    const alt = this.camera.position.length() - R;
    this.controls.rotateSpeed = clamp(alt / 7, 0.03, 1);
    this.controls.zoomSpeed = clamp(0.4 + alt / 10, 0.4, 1.2);
    this.camera.near = clamp(alt * 0.02, 0.002, 0.5);
    this.camera.updateProjectionMatrix();
    const wf = clamp(Math.sqrt(5.6 / alt), 0.75, 3.2);
    this.riverLayers.forEach((l, i) => (l.mat.linewidth = RIVER_WIDTH[i] * wf));

    // Animate column heights towards their targets; rescale radius with zoom.
    const k = 1 - Math.pow(0.0015, Math.min(rawDt, 0.1));
    for (let i = 0; i < this.columnHeights.length; i++) {
      const d = this.columnTargets[i] - this.columnHeights[i];
      if (Math.abs(d) > 1e-5) { this.columnHeights[i] += d * k; this.columnsDirty = true; }
      const dr = this.columnRadiusTargets[i] - this.columnRadius[i];
      if (Math.abs(dr) > 1e-4) { this.columnRadius[i] += dr * k; this.columnsDirty = true; }
    }
    if (Math.abs(alt - this.lastAlt) > 1e-3) { this.columnsDirty = true; this.lastAlt = alt; }
    if (this.columnsDirty) { this.writeColumnMatrices(); this.columnsDirty = false; }

    this.controls.update();
    this.applyPitch();
    this.sun.position.copy(this.camera.position).add(new THREE.Vector3(0, 3, 0));
    this.renderer.render(this.scene, this.camera);
    const el = this.host.nativeElement;
    this.updateLabels(el.clientWidth, el.clientHeight);
    this.raf = requestAnimationFrame(this.frame);
  };
}
