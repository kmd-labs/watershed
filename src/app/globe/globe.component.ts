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
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { ThemeService } from '@kmd/design-system';
import { BalticData, Basin, Poly } from '../core/data/baltic.model';
import { cssToHex } from '../core/color';
import { MapView, MOSAIC_COUNT, SUB_COUNT, mosaicToken, subToken } from '../core/data/views';

export interface GlobeHover {
  /** Basin under the pointer. */
  id: number;
  x: number;
  y: number;
}

/** Camera state: the point the view is centred on, and the altitude above the surface. */
interface View {
  lon: number;
  lat: number;
  alt: number;
}

const R = 5;
const DEG = Math.PI / 180;
const RIVER_WIDTH = [0.5, 0.85, 1.4, 2.2, 3.2];
const RIVER_OPACITY = [0.3, 0.5, 0.75, 0.9, 0.95];
/** In the mosaic the rivers are the colour, so even the smallest streams stay legible. */
const MOSAIC_RIVER_OPACITY = [0.6, 0.75, 0.9, 1, 1];
/** How far rivers of other basins fade toward the ground while one basin is selected. */
const MOSAIC_FADE = 0.8;
/** Country border width in CSS pixels; dash length stays ~6 px on screen at any zoom. */
const BORDER_WIDTH = 1.6;
const BORDER_DASH_PER_ALT = 0.005;
/** The camera looks this far north of its nadir (× altitude), giving a gentle ~14° oblique view. */
const PITCH = 0.25;
/** Closest zoom (altitude above the surface, in globe units; R = 5 ≈ 6371 km). */
const ALT_MIN = 0.08;
/** How far beyond the starting view the user may zoom out. */
const ALT_OUT = 1.15;
/** Context ring drawn around the data box (lon°, lat°); it fades into the page background. */
const CONTEXT_MARGIN: [number, number] = [7, 3.5];
/** Pixels the pointer must travel before a press turns into a drag (keeps clicks steady). */
const DRAG_SLOP = 3;
/** Movement (px) above which a press is no longer a click. */
const CLICK_SLOP = 6;
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
 * Cut-out of the globe over the Baltic drainage basin (the kmd-labs/baltic look): only a curved
 * slice of the sphere is drawn, fading into the page background. It shows river catchments
 * (plain, tinted by sea, or as a river-colour mosaic), the HydroRIVERS network, lakes, country
 * borders and labels.
 *
 * Navigation is map-like and exact: dragging keeps the grabbed point under the pointer, the wheel
 * and pinch zoom about the pointer, the view stays north-up and inside the basin, and nothing
 * coasts on after release.
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
  readonly view = input<MapView>('catchments');
  readonly selected = input<number>(-1);
  readonly showRivers = input(true);
  readonly showBorders = input(false);
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
  private rivers = new THREE.Group();
  private riverLayers: RiverLayer[] = [];
  private borders?: LineSegments2;
  private borderMat?: LineMaterial;

  private regionCanvas = document.createElement('canvas');
  private regionCtx!: CanvasRenderingContext2D;
  private regionTex!: THREE.CanvasTexture;
  private RW = 0;
  private RH = 0;

  /** Current camera state, the starting one, and the zoom-out limit. */
  private cam: View = { lon: 20, lat: 59, alt: 3.2 };
  private home: View = { lon: 20, lat: 59, alt: 3.2 };
  private altMax = 3.7;
  private fly: { from: View; to: View; t: number } | null = null;

  private labels: Label[] = [];
  private raf = 0;
  private clock = new THREE.Clock();
  private resizeObs?: ResizeObserver;
  private ready = false;
  private colors: Record<string, string> = {};
  private subColors: string[] = [];
  private mosaicColors: THREE.Color[] = [];

  constructor() {
    effect(() => {
      this.view();
      this.selected();
      if (!this.ready) return;
      this.drawRegion();
      this.colorRivers();
    });
    effect(() => {
      const v = this.showRivers();
      this.rivers.visible = v;
    });
    effect(() => {
      const v = this.showBorders();
      if (this.borders) this.borders.visible = v;
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
    this.renderer?.dispose();
  }

  /** Smoothly moves the camera over a basin. */
  flyToBasin(id: number) {
    const b = this.data().basins[id];
    if (!b) return;
    const alt = clamp(0.4 + Math.sqrt(b.kind === 'basin' ? b.area : 400) / 260, 0.6, Math.min(3.4, this.altMax));
    const [lon, lat] = b.mouth ? [lerp(b.cen[0], b.mouth[0], 0.35), lerp(b.cen[1], b.mouth[1], 0.35)] : b.cen;
    this.fly = { from: { ...this.cam }, to: this.clampView({ lon, lat, alt }), t: 0 };
  }

  // ─── camera ───────────────────────────────────────────────────────────────

  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly look = new THREE.Vector3();
  private readonly north = new THREE.Vector3();

  /**
   * Places the camera for `cam`: south of the target at the given altitude, then aimed north of
   * its nadir so the pitched view is centred on the target, north up.
   */
  private placeCamera() {
    const { lon, lat, alt } = this.cam;
    const southDeg = (alt * PITCH) / R / DEG;
    lonLatToVec(lon, clamp(lat - southDeg, -80, 80), R + alt, this.camera.position);
    const dir = this.look.copy(this.camera.position).normalize();
    this.north.copy(this.up).addScaledVector(dir, -dir.dot(this.up)).normalize();
    this.look.multiplyScalar(R).addScaledVector(this.north, alt * PITCH);
    this.camera.lookAt(this.look);
    this.camera.updateMatrixWorld();
  }

  /** Keeps the view centre over the data box and the altitude within limits. */
  private clampView(v: View): View {
    const [LON0, LON1, LAT0, LAT1] = this.data().bbox;
    return {
      lon: clamp(v.lon, LON0 + 1, LON1 - 1),
      lat: clamp(v.lat, LAT0 + 1, LAT1 - 1),
      alt: clamp(v.alt, ALT_MIN, this.altMax)
    };
  }

  /**
   * Moves the view so that `grab` (lon/lat) sits under the screen point (x, y). Two passes of a
   * plain lon/lat shift are exact to well under a pixel at every zoom.
   */
  private pinTo(grab: [number, number], x: number, y: number) {
    for (let k = 0; k < 2; k++) {
      this.placeCamera();
      const at = this.lonLatAt(x, y);
      if (!at) return;
      this.cam = this.clampView({ lon: this.cam.lon + grab[0] - at[0], lat: this.cam.lat + grab[1] - at[1], alt: this.cam.alt });
    }
    this.placeCamera();
  }

  /** Zooms by `factor` (< 1 = in) about the screen point (x, y). */
  private zoomAbout(factor: number, x: number, y: number) {
    this.placeCamera();
    const grab = this.lonLatAt(x, y);
    this.cam = this.clampView({ ...this.cam, alt: this.cam.alt * factor });
    if (grab) this.pinTo(grab, x, y);
    else this.placeCamera();
  }

  // ─── setup ────────────────────────────────────────────────────────────────

  private readColors() {
    // Normalised to #rrggbb: THREE.Color cannot parse the fractional rgb() Sass mixes emit.
    const tok = (k: string, fb: string) => cssToHex(this.theme.getTokenColor(k, fb), fb);
    // Design-system globe tokens first, then the app's own watershed tokens (src/styles.scss).
    this.colors = {
      bg: tok('globe-bg', '#f5f7fb'),
      land: tok('globe-land-fill', '#cfd8e3'),
      ocean: tok('globe-ocean', '#dbeafe'),
      lake: tok('globe-lake', '#bfdbfe'),
      catchment: tok('globe-catchment', '#ddd5cc'),
      catchmentActive: tok('globe-catchment-active', '#f7cfa0'),
      coast: tok('globe-coast', '#ebe1d8'),
      outline: tok('globe-outline', '#334155'),
      river: tok('globe-river', '#94a3b8'),
      riverActive: tok('globe-river-active', '#0284c7'),
      ink: tok('text-bright', '#0f172a'),
      border: tok('text-note', '#475569')
    };
    this.subColors = Array.from({ length: SUB_COUNT }, (_, i) => tok(subToken(i), this.colors['catchment']));
    this.colors['mosaicGround'] = tok('globe-mosaic-ground', '#ffffff');
    this.mosaicColors = Array.from({ length: MOSAIC_COUNT }, (_, i) => new THREE.Color(tok(mosaicToken(i), this.colors['river'])));
  }

  private init() {
    const data = this.data();
    const canvas = this.canvasRef().nativeElement;
    this.readColors();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(this.colors['bg']);

    this.buildContext(data);
    this.buildRegion(data);
    this.buildRivers(data);
    this.buildBorders(data);

    this.ready = true;
    this.drawRegion();
    this.colorRivers();
    this.rivers.visible = this.showRivers();
    this.borders!.visible = this.showBorders();
    this.buildLabels();

    const w = this.host.nativeElement.clientWidth, h = this.host.nativeElement.clientHeight;
    this.home = { lon: 20, lat: 59, alt: w / Math.max(h, 1) < 0.9 ? 4.6 : 3.2 };
    this.altMax = this.home.alt * ALT_OUT;
    this.cam = { ...this.home };

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.host.nativeElement);
    this.resize();

    this.bindPointer(canvas);
    this.frame();
  }

  /**
   * Coarse land and sea in a ring around the data box, fading to transparent at its outer edge so
   * the cut-out melts into the page. The detailed region patch sits on top of its inner part.
   */
  private buildContext(data: BalticData) {
    const [LON0, LON1, LAT0, LAT1] = data.bbox;
    const [mx, my] = CONTEXT_MARGIN;
    const W0 = LON0 - mx, W1 = LON1 + mx, S0 = LAT0 - my, S1 = LAT1 + my;
    const W = 2048;
    const H = Math.round((W * (S1 - S0)) / (W1 - W0) / Math.cos(59 * DEG));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const x = cv.getContext('2d')!;
    x.fillStyle = this.colors['ocean']; x.fillRect(0, 0, W, H);
    x.fillStyle = this.colors['land'];
    for (const poly of data.world) {
      x.beginPath();
      for (const ring of poly) {
        for (let k = 0; k < ring.length; k += 2) {
          const px = ((ring[k] - W0) / (W1 - W0)) * W, py = ((S1 - ring[k + 1]) / (S1 - S0)) * H;
          k ? x.lineTo(px, py) : x.moveTo(px, py);
        }
        x.closePath();
      }
      x.fill('evenodd');
    }
    // Feather: each edge erases with a smooth ramp over most of the margin; corners compound.
    const fx = (mx / (W1 - W0)) * W * 0.9, fy = (my / (S1 - S0)) * H * 0.9;
    x.globalCompositeOperation = 'destination-out';
    const ramp = (g: CanvasGradient) => {
      [[0, 1], [0.3, 0.72], [0.6, 0.3], [0.85, 0.07], [1, 0]].forEach(([o, a]) => g.addColorStop(o, `rgba(0,0,0,${a})`));
      return g;
    };
    x.fillStyle = ramp(x.createLinearGradient(0, 0, fx, 0)); x.fillRect(0, 0, fx, H);
    x.fillStyle = ramp(x.createLinearGradient(W, 0, W - fx, 0)); x.fillRect(W - fx, 0, fx, H);
    x.fillStyle = ramp(x.createLinearGradient(0, 0, 0, fy)); x.fillRect(0, 0, W, fy);
    x.fillStyle = ramp(x.createLinearGradient(0, H, 0, H - fy)); x.fillRect(0, H - fy, W, fy);
    x.globalCompositeOperation = 'source-over';

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(R, 128, 96, (W0 + 180) * DEG, (W1 - W0) * DEG, (90 - S1) * DEG, (S1 - S0) * DEG),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    mesh.renderOrder = 0;
    this.scene.add(mesh);
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

  /**
   * Country borders as screen-space dashed lines drawn above the rivers. Baking them into the
   * region texture made them vanish at overview zoom, where that texture is minified ~12×.
   */
  private buildBorders(data: BalticData) {
    let nseg = 0;
    for (const ln of data.borders) nseg += ln.length / 2 - 1;
    const P = new Float32Array(nseg * 6);
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    const rr = R * 1.0014;
    let s = 0;
    for (const ln of data.borders) {
      lonLatToVec(ln[0], ln[1], rr, v);
      for (let k = 2; k < ln.length; k += 2, s++) {
        lonLatToVec(ln[k], ln[k + 1], rr, w);
        P.set([v.x, v.y, v.z, w.x, w.y, w.z], s * 6);
        v.copy(w);
      }
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(P);
    this.borderMat = new LineMaterial({
      color: new THREE.Color(this.colors['border']).getHex(),
      linewidth: BORDER_WIDTH,
      transparent: true,
      opacity: this.theme.getTokenOpacity('strong', 0.8),
      dashed: true,
      dashSize: 1,
      gapSize: 0.6,
      depthWrite: false
    });
    this.borders = new LineSegments2(geo, this.borderMat);
    this.borders.computeLineDistances();
    this.borders.frustumCulled = false;
    this.borders.renderOrder = 8;
    this.scene.add(this.borders);
  }

  /**
   * HydroRIVERS routes flow through lakes as straight synthetic reaches (hundreds of parallel lines
   * across Ladoga and Onega). Segments whose midpoint lies on a lake are skipped; rivers still
   * meet the shore, and the lake fill carries the water.
   */
  private buildRivers(data: BalticData) {
    this.scene.add(this.rivers);
    this.riverLayers = data.rivers.map((rc, ci) => {
      let total = 0;
      for (const n of rc.cnt) total += n - 1;
      const P = new Float32Array(total * 6);
      const segBasin = new Uint16Array(total);
      const v = new THREE.Vector3(), w = new THREE.Vector3();
      const rr = R * (1.0009 + ci * 0.00012);
      let o = 0, s = 0;
      for (let i = 0; i < rc.cnt.length; i++) {
        let lon = data.qx(rc.xy[o * 2]), lat = data.qy(rc.xy[o * 2 + 1]);
        lonLatToVec(lon, lat, rr, v); o++;
        for (let k = 1; k < rc.cnt[i]; k++, o++) {
          const lon2 = data.qx(rc.xy[o * 2]), lat2 = data.qy(rc.xy[o * 2 + 1]);
          lonLatToVec(lon2, lat2, rr, w);
          if (!data.inLake((lon + lon2) / 2, (lat + lat2) / 2)) {
            P.set([v.x, v.y, v.z, w.x, w.y, w.z], s * 6);
            segBasin[s++] = rc.g[i];
          }
          v.copy(w);
          lon = lon2; lat = lat2;
        }
      }
      const nseg = s;
      const geo = new LineSegmentsGeometry();
      geo.setPositions(P.slice(0, nseg * 6));
      const col = new Float32Array(nseg * 6);
      geo.setColors(col);
      const mat = new LineMaterial({ vertexColors: true, linewidth: RIVER_WIDTH[ci], transparent: true, opacity: RIVER_OPACITY[ci], depthWrite: ci > 0 });
      const line = new LineSegments2(geo, mat);
      line.frustumCulled = false;
      line.renderOrder = 2 + ci;
      this.rivers.add(line);
      return { geo, mat, segBasin: segBasin.slice(0, nseg), col, nseg };
    });
  }

  // ─── styling (re-run on view / selection change) ─────────────────────────

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
    const view = this.view();
    const sel = this.selected();
    const s = this.RW / 4096;

    x.fillStyle = this.colors['ocean']; x.fillRect(0, 0, this.RW, this.RH);
    x.fillStyle = this.colors['land'];
    for (const p of data.land) { this.pathPoly(p); x.fill('evenodd'); }

    data.basins.forEach((b, i) => {
      // In the mosaic the rivers carry the colour; the basin itself is plain ground.
      x.fillStyle =
        view === 'mosaic' ? this.colors['mosaicGround']
        : i === sel ? this.colors['catchmentActive']
        : view === 'seas' ? this.subColors[b.sub]
        : b.river ? this.colors['catchment'] : this.colors['coast'];
      this.pathPoly(data.basinPolys[i]);
      x.fill('evenodd');
    });

    x.fillStyle = this.colors['lake'];
    for (const p of data.lakes) { this.pathPoly(p); x.fill('evenodd'); }

    // Catchment and sub-basin lines; the mosaic draws its borders with colour alone.
    if (view !== 'mosaic') {
      x.strokeStyle = this.colors['ink']; x.globalAlpha = 0.16; x.lineWidth = 0.9 * s;
      data.basins.forEach((b, i) => { if (b.kind === 'basin') { this.pathPoly(data.basinPolys[i]); x.stroke(); } });
      x.globalAlpha = 0.35; x.lineWidth = 1.6 * s;
      for (let k = 0; k < 6; k++) { this.pathPoly(data.outlines[k]); x.stroke(); }
      x.globalAlpha = 1;
    }

    x.strokeStyle = this.colors['outline']; x.lineWidth = 2.6 * s;
    this.pathPoly(data.outlines[6]); x.stroke();

    if (sel >= 0) {
      x.strokeStyle = this.colors['ink']; x.lineWidth = 3.4 * s;
      this.pathPoly(data.basinPolys[sel]); x.stroke();
    }
    this.regionTex.needsUpdate = true;
  }

  private colorRivers() {
    const sel = this.selected();
    const basins = this.data().basins;
    const mosaic = this.view() === 'mosaic';
    const base = new THREE.Color(this.colors['river']);
    const active = new THREE.Color(this.colors['riverActive']);
    const ground = new THREE.Color(this.colors['mosaicGround']);
    // Mosaic: each basin in its own colour; a selection fades every other basin toward the ground.
    const tint = this.mosaicColors.map(c => (sel < 0 ? c : c.clone().lerp(ground, MOSAIC_FADE)));
    this.riverLayers.forEach((layer, ci) => {
      layer.mat.opacity = (mosaic ? MOSAIC_RIVER_OPACITY : RIVER_OPACITY)[ci];
      for (let s = 0; s < layer.nseg; s++) {
        const id = layer.segBasin[s];
        const c = mosaic
          ? id === sel ? this.mosaicColors[basins[id].mosaic] : tint[basins[id].mosaic]
          : id === sel ? active : base;
        const o = s * 6;
        layer.col[o] = layer.col[o + 3] = c.r;
        layer.col[o + 1] = layer.col[o + 4] = c.g;
        layer.col[o + 2] = layer.col[o + 5] = c.b;
      }
      const attr = layer.geo.attributes['instanceColorStart'] as THREE.InterleavedBufferAttribute;
      (attr.data.array as Float32Array).set(layer.col);
      attr.data.needsUpdate = true;
    });
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
      .sort((a, b) => b.area - a.area)
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
  private sphere = new THREE.Sphere(new THREE.Vector3(), R);
  private hit = new THREE.Vector3();

  /** Lon/lat of the surface under a screen point (client coordinates), or null off the sphere. */
  private lonLatAt(clientX: number, clientY: number): [number, number] | null {
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.ray.intersectSphere(this.sphere, this.hit) ? vecToLonLat(this.hit) : null;
  }

  // ─── pointer: grab-to-pan, zoom about the pointer, click to pick ──────────

  private pointers = new Map<number, { x: number; y: number }>();
  /** Lon/lat held under the pointer (or under the pinch midpoint) while dragging. */
  private grab: [number, number] | null = null;
  private press: { x: number; y: number; moved: number; multi: boolean } | null = null;
  private dragging = false;
  private pinchDist = 0;

  private midpoint() {
    const p = [...this.pointers.values()];
    return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) };
  }

  private bindPointer(canvas: HTMLCanvasElement) {
    const regrab = () => {
      this.placeCamera();
      if (this.pointers.size === 1) {
        const p = [...this.pointers.values()][0];
        this.grab = this.lonLatAt(p.x, p.y);
      } else if (this.pointers.size === 2) {
        const m = this.midpoint();
        this.grab = this.lonLatAt(m.x, m.y);
        this.pinchDist = m.d;
      }
    };

    canvas.addEventListener('pointerdown', e => {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic or already-released pointers cannot be captured; dragging still works.
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.fly = null;
      if (this.pointers.size === 1) this.press = { x: e.clientX, y: e.clientY, moved: 0, multi: false };
      else if (this.press) this.press.multi = true;
      regrab();
    });

    canvas.addEventListener('pointermove', e => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        // Plain hover (mouse, no button held).
        if (e.pointerType !== 'mouse') return;
        const at = this.lonLatAt(e.clientX, e.clientY);
        const id = at ? this.basinAt(at[0], at[1]) : -1;
        canvas.style.cursor = id >= 0 ? 'pointer' : 'grab';
        this.emitHover(id >= 0 ? { id, x: e.clientX, y: e.clientY } : null);
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
      if (this.press) this.press.moved = Math.max(this.press.moved, Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y));
      if (this.pointers.size === 2) {
        const m = this.midpoint();
        if (this.pinchDist > 0 && m.d > 0) this.cam = this.clampView({ ...this.cam, alt: (this.cam.alt * this.pinchDist) / m.d });
        this.pinchDist = m.d;
        if (this.grab) this.pinTo(this.grab, m.x, m.y);
        this.dragging = true;
      } else if (this.grab && (this.dragging || (this.press?.moved ?? 0) > DRAG_SLOP)) {
        this.dragging = true;
        canvas.style.cursor = 'grabbing';
        this.emitHover(null);
        this.pinTo(this.grab, e.clientX, e.clientY);
      }
    });

    const release = (e: PointerEvent) => {
      if (!this.pointers.delete(e.pointerId)) return;
      if (this.pointers.size > 0) { regrab(); return; }
      const press = this.press;
      this.press = null;
      this.grab = null;
      this.dragging = false;
      canvas.style.cursor = 'grab';
      if (e.type !== 'pointerup' || !press || press.multi || press.moved > CLICK_SLOP) return;
      const at = this.lonLatAt(e.clientX, e.clientY);
      const id = at ? this.basinAt(at[0], at[1]) : -1;
      this.zone.run(() => this.pick.emit(id));
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', () => { if (!this.pointers.size) this.emitHover(null); });

    canvas.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        this.fly = null;
        // Line-mode wheels step coarser; trackpad pinch (ctrlKey) sends small deltas, so it is boosted.
        const k = e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0015;
        this.zoomAbout(Math.exp(clamp(e.deltaY, -300, 300) * k), e.clientX, e.clientY);
      },
      { passive: false }
    );
    canvas.style.cursor = 'grab';
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
    this.borderMat?.resolution.set(w, h);
  }

  private frame = () => {
    const rawDt = this.clock.getDelta();
    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + Math.min(rawDt, 0.25) / 1.1);
      const e = 1 - Math.pow(1 - this.fly.t, 3);
      const { from, to } = this.fly;
      // Altitude eases geometrically so zooming in and out feel equally paced.
      this.cam = { lon: lerp(from.lon, to.lon, e), lat: lerp(from.lat, to.lat, e), alt: from.alt * Math.pow(to.alt / from.alt, e) };
      if (this.fly.t >= 1) this.fly = null;
    }
    this.placeCamera();
    const alt = this.cam.alt;
    this.camera.near = clamp(alt * 0.02, 0.002, 0.5);
    this.camera.updateProjectionMatrix();
    const wf = clamp(Math.sqrt(5.6 / alt), 0.75, 3.2);
    this.riverLayers.forEach((l, i) => (l.mat.linewidth = RIVER_WIDTH[i] * wf));
    if (this.borderMat) this.borderMat.dashScale = 1 / (alt * BORDER_DASH_PER_ALT);

    this.renderer.render(this.scene, this.camera);
    const el = this.host.nativeElement;
    this.updateLabels(el.clientWidth, el.clientHeight);
    this.raf = requestAnimationFrame(this.frame);
  };
}
