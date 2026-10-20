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
import { CYANO_TOKENS, OXYGEN_TOKENS, SeaGrid, SeaLayer, cyanoClass, oxygenClass } from '../core/data/sea-layers';

export interface GlobeHover {
  /** Basin under the pointer, or -1 over the sea. */
  id: number;
  x: number;
  y: number;
  lon: number;
  lat: number;
}

const R = 5;
const DEG = Math.PI / 180;
const RIVER_WIDTH = [0.5, 0.85, 1.4, 2.2, 3.2];
const RIVER_OPACITY = [0.3, 0.5, 0.75, 0.9, 0.95];
/** World radius of the phosphorus circle for the largest river load (circle area ∝ load). */
const DISC_MAX_RADIUS = 0.075;
/** The camera looks this far north of its nadir (× altitude), giving a gentle ~14° oblique view. */
const PITCH = 0.25;
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
 * the HydroRIVERS network, sea overlays, and circles at river mouths sized by the phosphorus load.
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
  /** Proportional circles of the phosphorus load at river mouths. */
  readonly showPhosphorus = input(false);
  readonly showBorders = input(true);
  readonly showLabels = input(true);
  /** Localized label for a river basin (dataset names are Polish). */
  readonly basinLabel = input<(b: Basin) => string>(b => b.name ?? '');
  readonly subNames = input<string[]>([]);
  /** Optional sea overlay (near-bottom oxygen or cyanobacteria bloom probability). */
  readonly seaLayer = input<SeaLayer>('none');
  readonly seaGrid = input<SeaGrid | null>(null);

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
  private discs!: THREE.InstancedMesh;
  private discBasins: number[] = [];

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
  private ramp: Record<Nutrient, THREE.Color[]> = { n: [], p: [] };
  private colors: Record<string, string> = {};

  constructor() {
    effect(() => {
      this.nutrient();
      this.selected();
      this.showBorders();
      this.seaLayer();
      this.seaGrid();
      if (!this.ready) return;
      this.drawRegion();
      this.colorRivers();
      this.colorDiscs();
    });
    effect(() => {
      const v = this.showRivers();
      this.rivers.visible = v;
    });
    effect(() => {
      const v = this.showPhosphorus();
      if (this.discs) this.discs.visible = v;
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
    const dist = clamp(R + 0.4 + Math.sqrt(b.kind === 'basin' ? b.area : 400) / 260, R + 0.6, R + 3.4);
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
    this.colors['anoxic'] = tok(OXYGEN_TOKENS.anoxic, '#4f46e5');
    this.colors['hypoxic'] = tok(OXYGEN_TOKENS.hypoxic, '#a78bfa');
    CYANO_TOKENS.forEach((k, i) => (this.colors['cyano' + i] = tok(k, '#38bdf8')));
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

    this.buildWorld(data);
    this.buildRegion(data);
    this.buildHalo();
    this.buildRivers(data);
    this.buildDiscs(data);

    this.ready = true;
    this.drawRegion();
    this.colorRivers();
    this.colorDiscs();
    this.rivers.visible = this.showRivers();
    this.discs.visible = this.showPhosphorus();
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

  /** Flat circles lying on the sphere at river mouths; area ∝ annual phosphorus load. */
  private buildDiscs(data: BalticData) {
    // Largest first, so smaller circles are drawn on top of the big ones.
    const ids = data.basins
      .filter(b => b.source !== 'none' && b.mouth)
      .sort((a, b) => b.load.p - a.load.p)
      .map(b => b.id);
    this.discBasins = ids;
    const max = data.basins[ids[0]].load.p;
    const geo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    this.discs = new THREE.InstancedMesh(geo, mat, ids.length);
    this.discs.frustumCulled = false;
    this.discs.renderOrder = 10;
    const up = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4();
    ids.forEach((id, i) => {
      const [lon, lat] = data.basins[id].mouth!;
      const p = lonLatToVec(lon, lat, R * 1.0016);
      const q = new THREE.Quaternion().setFromUnitVectors(up, p.clone().normalize());
      const r = Math.max(0.0025, DISC_MAX_RADIUS * Math.sqrt(data.basins[id].load.p / max));
      this.discs.setMatrixAt(i, m.compose(p, q, new THREE.Vector3(r, 1, r)));
      this.discs.setColorAt(i, new THREE.Color());
    });
    this.scene.add(this.discs);
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
    this.drawSeaLayer();
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

  /**
   * Paints the active sea overlay: classes are rasterised one pixel per grid cell, then scaled up
   * with smoothing so the 0.1° grid reads as soft zones. Land is drawn on top afterwards.
   */
  private drawSeaLayer() {
    const layer = this.seaLayer();
    const g = this.seaGrid();
    if (layer === 'none' || !g) return;
    const small = document.createElement('canvas');
    small.width = g.nlon;
    small.height = g.nlat;
    const sc = small.getContext('2d')!;
    const img = sc.createImageData(g.nlon, g.nlat);
    const rgb = (hex: string) => new THREE.Color(hex);
    const classColors = layer === 'oxygen'
      ? { anoxic: rgb(this.colors['anoxic']), hypoxic: rgb(this.colors['hypoxic']) }
      : null;
    const cyanoColors = CYANO_TOKENS.map((_, k) => rgb(this.colors['cyano' + k]));
    for (let i = 0; i < g.nlat; i++) {
      for (let j = 0; j < g.nlon; j++) {
        const v = g.values[i * g.nlon + j];
        let c: THREE.Color | undefined;
        if (classColors) {
          const k = oxygenClass(v);
          c = k ? classColors[k] : undefined;
        } else {
          const k = cyanoClass(v);
          c = k >= 0 ? cyanoColors[k] : undefined;
        }
        if (!c) continue;
        const o = ((g.nlat - 1 - i) * g.nlon + j) * 4; // image rows run north → south
        img.data[o] = c.r * 255; img.data[o + 1] = c.g * 255; img.data[o + 2] = c.b * 255; img.data[o + 3] = 235;
      }
    }
    sc.putImageData(img, 0, 0);
    const [LON0, LON1, LAT0, LAT1] = this.data().bbox;
    const sx = this.RW / (LON1 - LON0), sy = this.RH / (LAT1 - LAT0);
    const x = this.regionCtx;
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(
      small,
      (g.lon0 - g.d / 2 - LON0) * sx,
      (LAT1 - (g.lat0 + (g.nlat - 1) * g.d + g.d / 2)) * sy,
      g.nlon * g.d * sx,
      g.nlat * g.d * sy
    );
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

  /** Phosphorus circles always use the P ramp; the selected river is inked, the rest fade. */
  private colorDiscs() {
    const sel = this.selected();
    const ramp = this.ramp.p;
    const strong = ramp[5];
    const faded = ramp[2];
    const ink = new THREE.Color(this.colors['ink']);
    this.discBasins.forEach((id, i) => this.discs.setColorAt(i, sel < 0 ? strong : id === sel ? ink : faded));
    if (this.discs.instanceColor) this.discs.instanceColor.needsUpdate = true;
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

  /** Basin id (or -1 for sea / outside) plus the lon/lat under the pointer; null when off the globe. */
  private pickAt(clientX: number, clientY: number): { id: number; lon: number; lat: number } | null {
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hitGlobe = this.ray.intersectObject(this.globe)[0];
    if (this.discs.visible) {
      // Smallest circle wins where they overlap (instances are ordered largest → smallest).
      const hits = this.ray.intersectObject(this.discs).filter(h => h.instanceId !== undefined);
      const hitCol = hits.sort((a, b) => b.instanceId! - a.instanceId!)[0];
      if (hitCol && (!hitGlobe || hitCol.distance <= hitGlobe.distance + 1e-2)) {
        const id = this.discBasins[hitCol.instanceId!];
        const [lon, lat] = this.data().basins[id].mouth!;
        return { id, lon, lat };
      }
    }
    if (!hitGlobe) return null;
    const [lon, lat] = vecToLonLat(hitGlobe.point);
    return { id: this.basinAt(lon, lat), lon, lat };
  }

  private bindPointer(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', e => { this.down = [e.clientX, e.clientY]; this.fly = null; });
    canvas.addEventListener('pointerup', e => {
      if (!this.down) return;
      const moved = Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]);
      this.down = null;
      if (moved > 6) return;
      const id = this.pickAt(e.clientX, e.clientY)?.id ?? -1;
      this.zone.run(() => this.pick.emit(id));
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || e.buttons) { this.emitHover(null); return; }
      const hit = this.pickAt(e.clientX, e.clientY);
      canvas.style.cursor = hit && hit.id >= 0 ? 'pointer' : '';
      // Sea positions only matter while a sea overlay is shown.
      const useful = hit && (hit.id >= 0 || this.seaLayer() !== 'none');
      this.emitHover(useful ? { ...hit, x: e.clientX, y: e.clientY } : null);
    });
    canvas.addEventListener('pointerleave', () => this.emitHover(null));
  }

  private hoverIdle = true;

  private emitHover(h: GlobeHover | null) {
    if (!h && this.hoverIdle) return;
    this.hoverIdle = !h;
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
    else if (w > 960) this.camera.setViewOffset(w, h, -Math.min(170, w * 0.11), h * 0.16, w, h);
    else this.camera.setViewOffset(w, h, 0, h * 0.08, w, h);
    this.camera.updateProjectionMatrix();
    for (const l of this.riverLayers) l.mat.resolution.set(w, h);
  }

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

    this.controls.update();
    this.applyPitch();
    this.renderer.render(this.scene, this.camera);
    const el = this.host.nativeElement;
    this.updateLabels(el.clientWidth, el.clientHeight);
    this.raf = requestAnimationFrame(this.frame);
  };
}
