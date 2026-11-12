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
import { isAtMost } from '@kmd/design-system/utils/breakpoints';
import { BalticData, Basin, Poly, RaindropPath, RiverClassGeometry } from '../core/data/baltic.model';
import { cssToHex } from '../core/color';
import { MapView, MOSAIC_COUNT, MosaicGround, STORY_STEPS, SUB_COUNT, mosaicToken, seaToken, subToken } from '../core/data/views';

export interface GlobeHover {
  /** Basin under the pointer. */
  id: number;
  x: number;
  y: number;
}

/** How the map looks on a printed poster (see `GlobeComponent.printBegin` / `printRender`). */
export interface PrintStyle {
  /** Paper: land, inside and outside the drainage basin. */
  paper: string;
  sea: string;
  /** Hairline along the drainage divide (around the focus basin, if any). */
  divide: string;
  /**
   * How the rivers are laid over the base map: drawn on white and multiplied (dark rivers on light
   * paper) or drawn on black and screened (light rivers on dark paper).
   */
  blend: 'multiply' | 'screen';
  /** River colour per basin (index = basin id). */
  riverColors: string[];
  /** The basin the poster is about, or −1 for the whole drainage basin. Rivers elsewhere fade. */
  focus: number;
  /** One ink (small streams lighter) rather than colours (even the smallest stay legible). */
  ink: boolean;
  seaLabel: string;
  seaNames: boolean;
  /** Hairline around lakes (subtler than the divide along the coast); none when absent. */
  lakeLine?: string;
}

export interface GlobePick {
  /** Basin under the pointer, or -1 off the basin. */
  id: number;
  lon: number;
  lat: number;
}

/** Camera state: the point the view is centred on, and the altitude above the surface. */
interface View {
  lon: number;
  lat: number;
  alt: number;
}

const R = 5;
const DEG = Math.PI / 180;
const RIVER_WIDTH = [0.5, 0.85, 1.35, 2.0, 2.8];
const RIVER_OPACITY = [0.3, 0.5, 0.75, 0.9, 0.95];
/** In the mosaic the rivers are the colour, so even the smallest streams stay legible. */
const MOSAIC_RIVER_OPACITY = [0.6, 0.75, 0.9, 1, 1];
/** How far other basins' rivers fade toward the ground: with a selection, and on hover alone. */
const MOSAIC_FADE = 0.8;
const MOSAIC_HOVER_FADE = 0.4;
/** Drainage-divide stroke strength, and the smallest ring it outlines (deg², ≈ 600 km²). */
const OUTLINE_ALPHA = 0.5;
const MIN_OUTLINE_RING = 0.05;
/** Width of the per-basin lookup texture (≥ number of basins). Row 0: colour; row 1: reveal. */
const BASIN_TEX = 2048;
/** "Where the rivers end": seconds for one sea's rivers to draw down to the coast. */
const STORY_REVEAL_S = 4.5;
/** Top-20 countdown: seconds for one river's network to draw down to its mouth. */
const TOP_REVEAL_S = 3.2;
/** Opacity of not-yet-revealed rivers (a grey ghost of the network). */
const STORY_GHOST = 0.35;
/** Country border width in CSS pixels. */
const BORDER_WIDTH = 1.6;
/** Screen length (px) of one dash unit for borders and the flow animation. */
const BORDER_DASH_PX = 5;
const FLOW_DASH_PX = 9;
/**
 * Flow animation: soft glints travel downstream over the rivers. One glint per (1 + FLOW_GAP) dash
 * units, moving FLOW_SPEED units a second; bigger river classes stretch the unit, so their glints
 * are longer and faster.
 */
const FLOW_GAP = 2.2;
const FLOW_SPEED = 1.1;
const FLOW_CLASS_STRETCH = 0.4;
/** The camera looks this far north of its nadir (× altitude), giving a gentle ~14° oblique view. */
const PITCH = 0.25;
/** Closest zoom (altitude above the surface, in globe units; R = 5 ≈ 6371 km). */
const ALT_MIN = 0.08;
/** How far beyond the starting view the user may zoom out. */
const ALT_OUT = 1.15;
/** Pixels the pointer must travel before a press turns into a drag (keeps clicks steady). */
const DRAG_SLOP = 3;
/** Movement (px) above which a press is no longer a click. */
const CLICK_SLOP = 6;
/** Hillshade strength (soft-light blend, applied in the base-map shader). */
const RELIEF_STRENGTH = 0.9;
const VFOV = 40;
/** Print: river widths per class in millimetres, opacity for ink and for coloured rivers, and the
 * narrow lens (deg) that makes the straight-down view read like a flat map. */
const PRINT_RIVER_MM = [0.07, 0.11, 0.18, 0.28, 0.42];
const PRINT_INK_OPACITY = [0.42, 0.58, 0.8, 0.95, 1];
const PRINT_COLOUR_OPACITY = [0.72, 0.85, 1, 1, 1];
const PRINT_FOV = 10;
const PRINT_TILE = 2048;
/** Thinner print lines break up; they are drawn this wide but lighter (same ink per length). */
const PRINT_MIN_LINE_PX = 0.8;
/** The basin's mass sits left of centre; the print map shifts right by this share of its width. */
const PRINT_SHIFT_X = 0.03;
/** Pixel ratio at rest (sharp) and while the map moves (fast); back to rest after this idle time. */
const MAX_DPR = 1.5;
const MOTION_DPR = 1;
const MOTION_IDLE_MS = 160;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Yields to the browser between setup stages (a task boundary, so the splash can paint). Not rAF:
 * that pauses in background tabs and would stall setup. */
const nextFrame = () => new Promise<void>(r => setTimeout(r, 0));

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

/** Sphere sector over a lon/lat box. */
function sector(box: [number, number, number, number], r: number, wSeg: number, hSeg: number) {
  const [w, e, s, n] = box;
  return new THREE.SphereGeometry(r, wSeg, hSeg, (w + 180) * DEG, (e - w) * DEG, (90 - n) * DEG, (n - s) * DEG);
}

/**
 * Rivers read their colour from a per-basin lookup texture instead of per-segment colours: the
 * segment's basin id travels in `instanceColorStart.x`. Hover, selection and view changes then
 * rewrite ~1,600 texels rather than ~200,000 segment colours.
 */
function patchBasinColours(
  mat: LineMaterial,
  tex: THREE.DataTexture,
  ghost: { value: THREE.Color },
  glint: { value: THREE.Color },
  glintMix: { value: number }
) {
  mat.onBeforeCompile = shader => {
    shader.uniforms['basinColors'] = { value: tex };
    shader.uniforms['uGhost'] = ghost;
    shader.uniforms['uGlint'] = glint;
    shader.uniforms['uGlintMix'] = glintMix;
    // instanceColorStart = (basin id, distance to the mouth in km, –). A segment is drawn in its
    // basin's colour once the basin's reveal threshold (row 1) drops below its distance.
    shader.vertexShader = shader.vertexShader
      .replace('attribute vec3 instanceColorEnd;', 'attribute vec3 instanceColorEnd;\nuniform sampler2D basinColors;\nuniform vec3 uGhost;\nvarying float vBasinAlpha;')
      .replace(
        'vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;',
        `float bu = ( instanceColorStart.x + 0.5 ) / ${BASIN_TEX}.0;
        vec4 bc = texture2D( basinColors, vec2( bu, 0.25 ) );
        vec4 rv = texture2D( basinColors, vec2( bu, 0.75 ) );
        bool shown = instanceColorStart.y >= rv.r;
        vColor.xyz = shown ? bc.rgb : uGhost;
        vBasinAlpha = shown ? bc.a : rv.g;`
      );
    // Flow (USE_DASH): instead of cutting the river into dashes, a soft glint runs downstream over
    // it — a long tail easing into a bright head — so the network stays whole while it moves.
    shader.fragmentShader = shader.fragmentShader
      .replace('uniform float opacity;', 'uniform float opacity;\nvarying float vBasinAlpha;\nuniform vec3 uGlint;\nuniform float uGlintMix;')
      .replace(
        'if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX',
        'float flowPh = fract( ( vLineDistance + dashOffset ) / ( dashSize + gapSize ) );'
      )
      .replace('vec4 diffuseColor = vec4( diffuse, alpha );', 'alpha *= vBasinAlpha;\nvec4 diffuseColor = vec4( diffuse, alpha );')
      .replace(
        'gl_FragColor = vec4( diffuseColor.rgb, alpha );',
        `#ifdef USE_DASH
          float flowGlint = smoothstep( 0.35, 0.93, flowPh ) * ( 1.0 - smoothstep( 0.93, 1.0, flowPh ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, uGlint, flowGlint * uGlintMix );
          alpha = mix( alpha, max( alpha, 0.95 ), flowGlint );
        #endif
        gl_FragColor = vec4( diffuseColor.rgb, alpha );`
      );
  };
  mat.customProgramCacheKey = () => 'basin-colours';
}

/** Uniforms shared by every material that shows the relief (one texture, one switch). */
interface ReliefUniforms {
  uRelief: { value: THREE.Texture };
  uReliefOn: { value: number };
  uReliefBox: { value: THREE.Vector4 };
}

/**
 * Soft-light hillshade in the fragment shader of a base-map material whose texture covers `box`
 * (lon0, lon1, lat0, lat1). The relief image covers `uReliefBox`; 128 = flat. Doing this on the
 * GPU means the relief can arrive late or be toggled without redrawing the large map canvas.
 */
function patchRelief(mat: THREE.MeshBasicMaterial, box: [number, number, number, number], u: ReliefUniforms) {
  const patchBox = new THREE.Vector4(...box);
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u, { uPatchBox: { value: patchBox } });
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uRelief;\nuniform float uReliefOn;\nuniform vec4 uReliefBox;\nuniform vec4 uPatchBox;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if ( uReliefOn > 0.0 ) {
          vec2 ll = vec2( mix( uPatchBox.x, uPatchBox.y, vMapUv.x ), mix( uPatchBox.z, uPatchBox.w, vMapUv.y ) );
          vec2 ruv = vec2( ( ll.x - uReliefBox.x ) / ( uReliefBox.y - uReliefBox.x ), ( uReliefBox.w - ll.y ) / ( uReliefBox.w - uReliefBox.z ) );
          float sh = texture2D( uRelief, ruv ).r;
          vec3 b = pow( max( diffuseColor.rgb, vec3( 0.0 ) ), vec3( 1.0 / 2.2 ) );
          vec3 lo = b - ( 1.0 - 2.0 * sh ) * b * ( 1.0 - b );
          vec3 hi = b + ( 2.0 * sh - 1.0 ) * ( sqrt( b ) - b );
          vec3 sl = sh <= 0.5 ? lo : hi;
          diffuseColor.rgb = pow( mix( b, sl, uReliefOn ), vec3( 2.2 ) );
        }`
      );
  };
  mat.customProgramCacheKey = () => 'relief';
}

interface Label {
  el: HTMLDivElement;
  p: THREE.Vector3;
  maxDist: number;
  w: number;
  h: number;
  text: string;
  kind: 'sea' | 'river' | 'big';
  /** Last values written to the DOM, so unchanged labels cost nothing per frame. */
  shown?: boolean;
  tf?: string;
}

interface RiverLayer {
  cls: number;
  line: LineSegments2;
  mat: LineMaterial;
  distances: boolean;
}

/** A small texture-mapped sector over one basin, used for the selection and hover highlights. */
interface Overlay {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  id: number;
}

/**
 * Cut-out of the globe over the Baltic drainage basin (the kmd-labs/baltic look): only a curved
 * slice of the sphere is drawn, fading into the page background.
 *
 * Navigation is map-like and exact: dragging keeps the grabbed point under the pointer, the wheel
 * and pinch zoom about the pointer, the view stays north-up and inside the basin.
 *
 * Performance: frames are rendered on demand (camera moves, hover, animations); river colours
 * come from a lookup texture; selection and hover draw into small overlays instead of redrawing
 * the large region texture; setup runs in stages so the splash keeps animating.
 */
@Component({
  selector: 'app-globe',
  standalone: true,
  template: `
    <canvas #canvas class="globe__canvas"></canvas>
    <div #labels class="globe__labels" aria-hidden="true"></div>
    <div #drop class="globe-drop" aria-hidden="true"></div>
  `,
  styleUrl: './globe.component.scss',
  encapsulation: ViewEncapsulation.None,
  host: { class: 'globe', '[class.globe--dark]': 'dark()' }
})
export class GlobeComponent implements AfterViewInit, OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly theme = inject(ThemeService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly data = input.required<BalticData>();
  /** River class 0 (smallest streams), added when it arrives. */
  readonly streams = input<RiverClassGeometry | null>(null);
  readonly relief = input<ImageBitmap | HTMLImageElement | null>(null);
  readonly view = input<MapView>('catchments');
  readonly ground = input<MosaicGround>('light');
  readonly selected = input<number>(-1);
  readonly drop = input<RaindropPath | null>(null);
  /** "Where the rivers end" step: 0 intro, 1–6 one sea each, 7 everything. */
  readonly storyStep = input(0);
  /** Top-rivers tour (drawn on the catchments map): basins in reveal order, and the step (−1 = off;
   * 0 intro, 1…n one river each, n + 1 all). */
  readonly topOrder = input<number[]>([]);
  readonly topStep = input(-1);
  /** Per-segment distance to the mouth for a river class (from the river network). */
  readonly mouthKm = input<((rc: RiverClassGeometry) => Float32Array | null) | null>(null);
  readonly showRivers = input(true);
  readonly showBorders = input(false);
  readonly showLabels = input(true);
  readonly showFlow = input(false);
  readonly showRelief = input(true);
  /** Localized label for a river basin (dataset names are Polish). */
  readonly basinLabel = input<(b: Basin) => string>(b => b.name ?? '');
  readonly subNames = input<string[]>([]);

  readonly pick = output<GlobePick>();
  readonly hover = output<GlobeHover | null>();
  /** Setup progress 0–1; 1 once the first frame is on screen. */
  readonly progress = output<number>();
  /** The map cannot be shown (no WebGL 2, or setup failed); the app explains and carries on. */
  readonly failed = output<void>();

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly labelsRef = viewChild.required<ElementRef<HTMLDivElement>>('labels');
  private readonly dropRef = viewChild.required<ElementRef<HTMLDivElement>>('drop');

  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(VFOV, 1, 0.005, 400);
  private rivers = new THREE.Group();
  private riverLayers: RiverLayer[] = [];
  private borders?: LineSegments2;
  private borderMat?: LineMaterial;
  private basinTex!: THREE.DataTexture;
  /** RGBA (linear) per basin id, backing `basinTex`. */
  private lut = new Float32Array(BASIN_TEX * 2 * 4);
  private readonly ghost = { value: new THREE.Color() };
  /** Flow glint colour and strength (set per view in updateBasinColours). */
  private readonly glint = { value: new THREE.Color() };
  private readonly glintMix = { value: 0.8 };
  /** Longest distance to a mouth among each sea's rivers (km), for the reveal pace. */
  private subMaxKm = new Array<number>(SUB_COUNT).fill(1);
  /** Longest distance to the mouth within each basin (km). */
  private basinMaxKm = new Float32Array(0);
  private seaColors: Record<MosaicGround, THREE.Color[]> = { light: [], dark: [] };
  private story = { t: 1 };

  private contextCanvas = document.createElement('canvas');
  private contextTex?: THREE.CanvasTexture;
  private contextMesh?: THREE.Mesh;
  /** Camera tilt (× altitude); 0 = straight down (print). */
  private pitch = PITCH;
  private regionCanvas = document.createElement('canvas');
  private regionCtx!: CanvasRenderingContext2D;
  private regionMat!: THREE.MeshBasicMaterial;
  /** Bumped per redraw so a slow upload never replaces a newer one. */
  private regionSeq = 0;
  private readonly relief$: ReliefUniforms = {
    uRelief: { value: new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1) },
    uReliefOn: { value: 0 },
    uReliefBox: { value: new THREE.Vector4() }
  };
  private RW = 0;
  private RH = 0;
  private selOverlay?: Overlay;
  private hovOverlay?: Overlay;

  private dropLine?: LineSegments2;
  private dropHalo?: LineSegments2;
  private dropReveal: { t: number; dur: number; path: RaindropPath } | null = null;
  private dropHead: [number, number] | null = null;

  /** Current camera state, the starting one, and the zoom-out limit. */
  private cam: View = { lon: 20, lat: 59, alt: 3.2 };
  private home: View = { lon: 20, lat: 59, alt: 3.2 };
  private altMax = 3.7;
  private fly: { from: View; to: View; t: number; dur: number } | null = null;
  private flowOffset = 0;
  /** Dynamic resolution: sharp at rest, lighter while dragging, pinching, zooming or flying. */
  private restDpr = 1;
  private moving = false;
  private motionTimer: ReturnType<typeof setTimeout> | null = null;
  /** Touch devices get lighter texture filtering (anisotropy) — invisible at this gentle tilt. */
  private readonly coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  private labels: Label[] = [];
  private raf = 0;
  private clock = new THREE.Clock();
  private resizeObs?: ResizeObserver;
  private ready = false;
  private dirty = true;
  private hovered = -1;
  private pendingHover: { x: number; y: number } | null = null;
  private colors: Record<string, string> = {};
  private subColors: string[] = [];
  private mosaicColors: Record<MosaicGround, THREE.Color[]> = { light: [], dark: [] };

  /** Views drawn on plain ground, where the rivers carry the colour. */
  private plain = () => this.view() === 'mosaic' || this.view() === 'story';
  /** The top-rivers tour is running (the app passes it on the catchments map). */
  private topActive = () => this.view() === 'catchments' && this.topStep() >= 0;
  /** Basin highlighted by the countdown's current step, or −1. */
  private topCurrent = () => {
    const step = this.topStep(), order = this.topOrder();
    return this.topActive() && step >= 1 && step <= order.length ? order[step - 1] : -1;
  };
  readonly dark = () => this.plain() && this.ground() === 'dark';

  constructor() {
    effect(() => {
      this.view();
      this.ground();
      if (this.ready && !this.printSaved) void this.restyle();
    });
    effect(() => {
      const img = this.relief();
      const on = this.showRelief();
      this.applyRelief(img, on);
    });
    effect(() => {
      this.selected();
      this.drop();
      if (!this.ready || this.printSaved) return;
      this.updateBasinColours();
      this.updateOverlays();
      this.invalidate();
    });
    effect(() => {
      const v = this.showRivers();
      if (this.printSaved) return;
      this.rivers.visible = v;
      this.invalidate();
    });
    effect(() => {
      const v = this.showBorders();
      if (this.printSaved) return;
      if (this.borders) this.borders.visible = v;
      this.invalidate();
    });
    effect(() => {
      const on = this.showFlow();
      if (this.ready && !this.printSaved) this.setFlow(on);
    });
    effect(() => {
      this.basinLabel();
      this.subNames();
      if (this.ready) { this.buildLabels(); this.invalidate(); }
    });
    effect(() => {
      const s = this.streams();
      if (this.ready && s && !this.riverLayers.some(l => l.cls === s.cls)) this.addRiverLayer(s);
    });
    effect(() => {
      const d = this.drop();
      if (this.ready && !this.printSaved) this.showDrop(d);
    });
    effect(() => {
      const step = this.storyStep();
      if (this.ready && !this.printSaved && this.view() === 'story') this.startStoryStep(step);
    });
    effect(() => {
      const step = this.topStep();
      this.topOrder();
      if (this.ready && !this.printSaved && this.view() === 'catchments') this.startTopStep(step);
    });
  }

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => {
      if (!GlobeComponent.webgl2()) { this.fail(new Error('WebGL 2 is not available')); return; }
      this.init().catch(err => this.fail(err));
    });
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
    this.flyTo({ lon, lat, alt });
  }

  /** Smoothly frames a lon/lat box. */
  flyToBox(lon0: number, lon1: number, lat0: number, lat1: number) {
    const el = this.host.nativeElement;
    const aspect = el.clientWidth / Math.max(1, el.clientHeight);
    const lat = (lat0 + lat1) / 2;
    // Visible latitude span ≈ 2·alt·tan(fov/2) / R radians.
    const perAlt = (2 * Math.tan((VFOV / 2) * DEG)) / R / DEG;
    const alt = Math.max(((lat1 - lat0) * 1.7) / perAlt, ((lon1 - lon0) * Math.cos(lat * DEG) * 1.7) / (perAlt * aspect), 0.25);
    this.flyTo({ lon: (lon0 + lon1) / 2, lat, alt });
  }

  private flyTo(to: View, dur = 1.1) {
    this.fly = { from: { ...this.cam }, to: this.clampView(to), t: 0, dur };
  }

  /** Zooms about the centre of the view (factor < 1 = in), eased; repeated presses add up. */
  zoomBy(factor: number) {
    if (!this.ready) return;
    const base = this.fly ? this.fly.to : this.cam;
    this.zone.runOutsideAngular(() => this.flyTo({ ...base, alt: base.alt * factor }, 0.4));
  }

  /** Flies back to the starting view of the whole drainage basin. */
  resetView() {
    if (this.ready) this.zone.runOutsideAngular(() => this.flyTo(this.home, 0.9));
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
    const southDeg = (alt * this.pitch) / R / DEG;
    lonLatToVec(lon, clamp(lat - southDeg, -80, 80), R + alt, this.camera.position);
    const dir = this.look.copy(this.camera.position).normalize();
    this.north.copy(this.up).addScaledVector(dir, -dir.dot(this.up)).normalize();
    this.look.multiplyScalar(R).addScaledVector(this.north, alt * this.pitch);
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
      if (!at) break;
      this.cam = this.clampView({ lon: this.cam.lon + grab[0] - at[0], lat: this.cam.lat + grab[1] - at[1], alt: this.cam.alt });
    }
    this.placeCamera();
    this.motion();
    this.invalidate();
  }

  /** Zooms by `factor` (< 1 = in) about the screen point (x, y). */
  private zoomAbout(factor: number, x: number, y: number) {
    this.motion();
    this.placeCamera();
    const grab = this.lonLatAt(x, y);
    this.cam = this.clampView({ ...this.cam, alt: this.cam.alt * factor });
    if (grab) this.pinTo(grab, x, y);
    else { this.placeCamera(); this.invalidate(); }
  }

  private invalidate() {
    this.dirty = true;
  }

  private aniso(): number {
    const max = this.renderer.capabilities.getMaxAnisotropy();
    return this.coarse ? Math.min(4, max) : max;
  }

  /** Called on every camera move: drop to MOTION_DPR, restore full sharpness once things settle. */
  private motion() {
    if (!this.moving && this.restDpr > MOTION_DPR) {
      this.moving = true;
      this.renderer.setPixelRatio(MOTION_DPR);
    }
    if (this.motionTimer) clearTimeout(this.motionTimer);
    this.motionTimer = setTimeout(() => {
      this.motionTimer = null;
      if (this.moving) {
        this.moving = false;
        this.renderer.setPixelRatio(this.restDpr);
        this.invalidate();
      }
    }, MOTION_IDLE_MS);
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
      border: tok('text-note', '#475569'),
      mosaicGround: tok('globe-mosaic-ground', '#ffffff'),
      darkBg: tok('globe-dark-bg', '#040812'),
      darkGround: tok('globe-dark-ground', '#040812'),
      darkLand: tok('globe-dark-land', '#0f172a'),
      darkOcean: tok('globe-dark-ocean', '#0b1530'),
      darkLake: tok('globe-dark-lake', '#132650'),
      darkOutline: tok('globe-dark-outline', '#475569'),
      drop: tok('globe-drop', '#d37400'),
      dropHalo: tok('globe-drop-halo', '#ffffff'),
      light: tok('neutral-200', '#e2e8f0')
    };
    this.subColors = Array.from({ length: SUB_COUNT }, (_, i) => tok(subToken(i), this.colors['catchment']));
    for (const g of ['light', 'dark'] as MosaicGround[]) {
      this.mosaicColors[g] = Array.from({ length: MOSAIC_COUNT }, (_, i) => new THREE.Color(tok(mosaicToken(i, g), this.colors['river'])));
      this.seaColors[g] = Array.from({ length: SUB_COUNT }, (_, i) => new THREE.Color(tok(seaToken(i, g), this.colors['river'])));
    }
    this.colors['ghost'] = tok('globe-story-ghost', '#cfd8e3');
    this.colors['glint'] = tok('globe-flow-glint', '#38bdf8');
    this.colors['glintDark'] = tok('globe-flow-glint-dark', '#ffffff');
    this.colors['glintPlain'] = tok('globe-flow-glint-plain', '#040812');
    this.colors['darkGhost'] = tok('globe-dark-story-ghost', '#1e293b');
  }

  private async init() {
    const data = this.data();
    const canvas = this.canvasRef().nativeElement;
    const mobile = isAtMost('mobile');
    const tablet = isAtMost('tablet');
    this.readColors();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
    // 1.5 looks nearly as crisp as 2–3 on HiDPI screens at a fraction of the fragment cost.
    this.restDpr = Math.min(devicePixelRatio || 1, MAX_DPR);
    this.renderer.setPixelRatio(this.restDpr);
    this.scene.background = new THREE.Color(this.colors['bg']);
    this.emitProgress(0.1);

    for (let i = 0; i < BASIN_TEX; i++) {
      this.lut.set([1, 1, 1, 1], i * 4);
      this.lut.set([-1, 0, 0, 0], (BASIN_TEX + i) * 4);
    }
    this.basinTex = new THREE.DataTexture(this.lut, BASIN_TEX, 2, THREE.RGBAFormat, THREE.FloatType);
    this.basinTex.minFilter = this.basinTex.magFilter = THREE.NearestFilter;
    this.basinTex.needsUpdate = true;

    await nextFrame();
    this.buildContext(data, mobile ? 1024 : 2048);
    performance.mark('watershed:ctx');
    this.emitProgress(0.2);

    await nextFrame();
    this.buildRegion(data, mobile ? 3072 : tablet ? 4096 : 5120);
    performance.mark('watershed:region');
    this.emitProgress(0.5);

    this.scene.add(this.rivers);
    for (const rc of data.rivers) {
      await nextFrame();
      this.addRiverLayer(rc);
      this.emitProgress(0.5 + 0.3 * (rc.cls / 4));
    }

    performance.mark('watershed:rivers');
    await nextFrame();
    this.buildBorders(data);
    this.selOverlay = this.makeOverlay(2048);
    this.hovOverlay = this.makeOverlay(1024);
    this.buildLabels();
    this.emitProgress(0.9);

    const w = this.host.nativeElement.clientWidth, h = this.host.nativeElement.clientHeight;
    this.home = { lon: 20, lat: 59, alt: w / Math.max(h, 1) < 0.9 ? 4.6 : 3.2 };
    this.altMax = this.home.alt * ALT_OUT;
    this.cam = { ...this.home };

    this.resizeObs = new ResizeObserver(() => { this.resize(); this.invalidate(); });
    this.resizeObs.observe(this.host.nativeElement);
    this.resize();
    this.bindPointer(canvas);

    this.ready = true;
    // The smallest streams may have arrived while setup was still running.
    const streams = this.streams();
    if (streams && !this.riverLayers.some(l => l.cls === streams.cls)) this.addRiverLayer(streams);
    await this.restyle();
    this.updateOverlays();
    this.rivers.visible = this.showRivers();
    this.borders!.visible = this.showBorders();
    this.setFlow(this.showFlow());
    this.showDrop(this.drop());
    performance.mark('watershed:restyled');
    // Compile shaders without blocking (parallel compile where the driver supports it).
    this.placeCamera();
    await this.renderer.compileAsync(this.scene, this.camera).catch(() => undefined);
    this.frame();
    performance.mark('watershed:firstframe');
    this.emitProgress(1);
  }

  /** WebGL 2 (required by three.js r170) can be created in this browser. */
  static webgl2(): boolean {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      return !!gl;
    } catch {
      return false;
    }
  }

  private fail(err: unknown) {
    console.error('Map unavailable:', err);
    cancelAnimationFrame(this.raf);
    this.zone.run(() => this.failed.emit());
  }

  private emitProgress(p: number) {
    this.zone.run(() => this.progress.emit(p));
  }

  /** Re-applies everything that depends on the view or the mosaic ground. */
  private restyle(): Promise<void> {
    this.scene.background = new THREE.Color(this.dark() ? this.colors['darkBg'] : this.colors['bg']);
    this.drawContext();
    const uploaded = this.drawRegion();
    this.setRiverOpacity();
    if (this.view() === 'story') this.startStoryStep(this.storyStep());
    if (this.borderMat) this.borderMat.color.set(this.dark() ? this.colors['light'] : this.colors['border']);
    this.updateBasinColours();
    this.updateOverlays();
    this.invalidate();
    return uploaded;
  }

  private applyRelief(img: ImageBitmap | HTMLImageElement | null, on: boolean) {
    const u = this.relief$;
    if (img && !(u.uRelief.value.image === img)) {
      const tex = new THREE.Texture(img as HTMLImageElement);
      tex.flipY = false; // row 0 = north; the shader maps lat → v itself
      tex.colorSpace = THREE.NoColorSpace; // shading data, not colour
      tex.needsUpdate = true;
      u.uRelief.value.dispose();
      u.uRelief.value = tex;
      const [W0, W1, S0, S1] = this.data().worldBox;
      u.uReliefBox.value.set(W0, W1, S0, S1);
    }
    u.uReliefOn.value = img && on ? RELIEF_STRENGTH : 0;
    this.invalidate();
  }

  // ─── base map ─────────────────────────────────────────────────────────────

  /**
   * Coarse land and sea in a ring around the data box, fading to transparent at its outer edge so
   * the cut-out melts into the page. The detailed region patch sits on top of its inner part.
   */
  private buildContext(data: BalticData, width: number) {
    const [W0, W1, S0, S1] = data.worldBox;
    this.contextCanvas.width = width;
    this.contextCanvas.height = Math.round((width * (S1 - S0)) / (W1 - W0) / Math.cos(59 * DEG));
    this.contextTex = new THREE.CanvasTexture(this.contextCanvas);
    this.contextTex.colorSpace = THREE.SRGBColorSpace;
    this.drawContext();
    const mat = new THREE.MeshBasicMaterial({ map: this.contextTex, transparent: true, depthWrite: false });
    patchRelief(mat, data.worldBox, this.relief$);
    const mesh = new THREE.Mesh(sector(data.worldBox, R, 128, 96), mat);
    mesh.renderOrder = 0;
    this.scene.add(mesh);
    this.contextMesh = mesh;
  }

  private drawContext() {
    const data = this.data();
    const [W0, W1, S0, S1] = data.worldBox;
    const [LON0, , LAT0] = data.bbox;
    const cv = this.contextCanvas, W = cv.width, H = cv.height;
    const x = cv.getContext('2d')!;
    const dark = this.dark();
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    x.fillStyle = dark ? this.colors['darkOcean'] : this.colors['ocean'];
    x.fillRect(0, 0, W, H);
    x.fillStyle = dark ? this.colors['darkLand'] : this.colors['land'];
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
    const fx = ((LON0 - W0) / (W1 - W0)) * W * 0.9, fy = ((LAT0 - S0) / (S1 - S0)) * H * 0.9;
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
    if (this.contextTex) this.contextTex.needsUpdate = true;
  }

  private buildRegion(data: BalticData, width: number) {
    const [LON0, LON1, LAT0, LAT1] = data.bbox;
    this.RW = Math.min(this.renderer.capabilities.maxTextureSize, width);
    this.RH = Math.round(((this.RW * (LAT1 - LAT0)) / (LON1 - LON0) / Math.cos(59 * DEG)) * 0.62);
    this.regionCanvas.width = this.RW;
    this.regionCanvas.height = this.RH;
    this.regionCtx = this.regionCanvas.getContext('2d')!;
    // Placeholder until the first upload, so the material is compiled with a map from the start.
    const placeholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    placeholder.needsUpdate = true;
    this.regionMat = new THREE.MeshBasicMaterial({ map: placeholder, polygonOffset: true, polygonOffsetFactor: -1 });
    patchRelief(this.regionMat, data.bbox, this.relief$);
    this.scene.add(new THREE.Mesh(sector(data.bbox, R * 1.0004, 160, 120), this.regionMat));
  }

  /** Lon/lat → pixel in a canvas covering `box`. */
  private pathPoly(x: CanvasRenderingContext2D, poly: Poly, box: [number, number, number, number], W: number, H: number) {
    const [w, e, s, n] = box;
    x.beginPath();
    for (const ring of poly) {
      for (let k = 0; k < ring.length; k += 2) {
        const px = ((ring[k] - w) / (e - w)) * W, py = ((n - ring[k + 1]) / (n - s)) * H;
        k ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.closePath();
    }
  }

  /**
   * The large base texture: depends on the view and the mosaic ground only. It is drawn upside
   * down so it can go to the GPU as an ImageBitmap without a flip.
   */
  private drawRegion(): Promise<void> {
    const data = this.data();
    const x = this.regionCtx;
    const view = this.view();
    const dark = this.dark();
    const s = this.RW / 4096;
    const [LON0, LON1, LAT0, LAT1] = data.bbox;
    const box: [number, number, number, number] = [LON0, LON1, LAT0, LAT1];
    const path = (p: Poly) => this.pathPoly(x, p, box, this.RW, this.RH);

    x.setTransform(1, 0, 0, -1, 0, this.RH);
    x.fillStyle = dark ? this.colors['darkOcean'] : this.colors['ocean']; x.fillRect(0, 0, this.RW, this.RH);
    x.fillStyle = dark ? this.colors['darkLand'] : this.colors['land'];
    for (const p of data.land) { path(p); x.fill('evenodd'); }

    data.basins.forEach((b, i) => {
      // In the mosaic the rivers carry the colour; the basin itself is plain ground.
      x.fillStyle =
        view === 'mosaic' || view === 'story' ? (dark ? this.colors['darkGround'] : this.colors['mosaicGround'])
        : view === 'seas' ? this.subColors[b.sub]
        : b.river ? this.colors['catchment'] : this.colors['coast'];
      path(data.basinPolys[i]);
      x.fill('evenodd');
    });

    x.fillStyle = dark ? this.colors['darkLake'] : this.colors['lake'];
    for (const p of data.lakes) { path(p); x.fill('evenodd'); }

    // Catchment and sub-basin lines; the mosaic draws its borders with colour alone.
    const soft = this.softOutlines();
    if (view !== 'mosaic' && view !== 'story') {
      x.strokeStyle = this.colors['ink']; x.globalAlpha = 0.16; x.lineWidth = 0.9 * s;
      data.basins.forEach((b, i) => { if (b.kind === 'basin') { path(data.basinPolys[i]); x.stroke(); } });
      x.globalAlpha = 0.28; x.lineWidth = 1.3 * s;
      for (let k = 0; k < 6; k++) { path(soft[k]); x.stroke(); }
    }

    // Drainage divide (it also traces the coast): soft and light, so skerries do not turn into
    // dark scribbles — land against water already reads from the fills.
    x.lineJoin = 'round';
    x.strokeStyle = dark ? this.colors['darkOutline'] : this.colors['outline'];
    x.globalAlpha = OUTLINE_ALPHA;
    x.lineWidth = 1.4 * s;
    path(soft[6]); x.stroke();
    x.globalAlpha = 1;
    x.setTransform(1, 0, 0, 1, 0, 0);
    return this.uploadRegion();
  }

  /**
   * Sends the region canvas to the GPU. A CanvasTexture of this size made Chrome read the
   * GPU-backed canvas back synchronously (~5 s at 5120 px on desktop, and again on every view
   * switch); an ImageBitmap snapshot is taken asynchronously and copied GPU-side.
   */
  private async uploadRegion() {
    const seq = ++this.regionSeq;
    let tex: THREE.Texture;
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(this.regionCanvas);
      if (seq !== this.regionSeq) { bmp.close(); return; }
      tex = new THREE.Texture(bmp as unknown as HTMLImageElement);
    } else {
      tex = new THREE.CanvasTexture(this.regionCanvas);
    }
    tex.flipY = false; // the canvas is already drawn south-up
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.aniso();
    tex.needsUpdate = true;
    const old = this.regionMat.map;
    this.regionMat.map = tex;
    if (old) {
      old.dispose();
      (old.image as ImageBitmap | undefined)?.close?.();
    }
    this.invalidate();
  }

  private softCache?: Poly[];

  /** Outlines without the rings of small islands (skerries), cached. */
  private softOutlines(): Poly[] {
    if (this.softCache) return this.softCache;
    const area = (r: Float32Array) => {
      let a = 0;
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1];
      return Math.abs(a / 2) * Math.cos(((r[1] ?? 59) * Math.PI) / 180);
    };
    return (this.softCache = this.data().outlines.map(p => p.filter(r => area(r) >= MIN_OUTLINE_RING)));
  }

  // ─── selection & hover overlays ───────────────────────────────────────────

  private makeOverlay(maxSide: number): Overlay {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    (canvas as HTMLCanvasElement & { maxSide?: number }).maxSide = maxSide;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(R, 2, 2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    );
    mesh.renderOrder = 1;
    mesh.visible = false;
    this.scene.add(mesh);
    return { mesh, canvas, tex, id: -1 };
  }

  private updateOverlays() {
    if (!this.selOverlay || !this.hovOverlay) return;
    const top = this.topCurrent();
    const sel = top >= 0 ? top : this.topActive() ? -1 : this.selected();
    this.paintOverlay(this.selOverlay, sel, 'sel');
    this.paintOverlay(this.hovOverlay, this.hovered !== sel ? this.hovered : -1, 'hov');
  }

  /**
   * Fills (catchment views) and/or outlines (all views) one basin into its own small texture on
   * a sphere sector just above the base map.
   */
  private paintOverlay(o: Overlay, id: number, kind: 'sel' | 'hov') {
    const data = this.data();
    const b = id >= 0 ? data.basins[id] : null;
    if (!b) { o.mesh.visible = false; o.id = -1; return; }
    const m = 0.03;
    const box: [number, number, number, number] = [b.bb[0] - m, b.bb[1] + m, b.bb[2] - m, b.bb[3] + m];
    const maxSide = (o.canvas as HTMLCanvasElement & { maxSide?: number }).maxSide ?? 1024;
    const aspect = ((box[1] - box[0]) * Math.cos(((box[2] + box[3]) / 2) * DEG)) / (box[3] - box[2]);
    const W = Math.max(8, Math.round(aspect >= 1 ? maxSide : maxSide * aspect));
    const H = Math.max(8, Math.round(aspect >= 1 ? maxSide / aspect : maxSide));
    o.canvas.width = W; o.canvas.height = H;
    const x = o.canvas.getContext('2d')!;
    x.clearRect(0, 0, W, H);
    const view = this.view();
    const dark = this.dark();
    const lw = Math.max(1.5, Math.max(W, H) / 380);
    this.pathPoly(x, data.basinPolys[id], box, W, H);
    if (view !== 'mosaic' && view !== 'story') {
      x.globalAlpha = kind === 'sel' ? 1 : 0.55;
      x.fillStyle = this.colors['catchmentActive'];
      x.fill('evenodd');
    }
    x.globalAlpha = kind === 'sel' ? 1 : 0.6;
    x.strokeStyle = dark ? this.colors['light'] : this.colors['ink'];
    x.lineWidth = kind === 'sel' ? lw * 1.6 : lw;
    x.lineJoin = 'round';
    x.stroke();
    x.globalAlpha = 1;
    o.tex.dispose();
    o.tex = new THREE.CanvasTexture(o.canvas);
    o.tex.colorSpace = THREE.SRGBColorSpace;
    o.tex.anisotropy = this.aniso();
    o.mesh.material.map = o.tex;
    o.mesh.material.needsUpdate = true;
    o.mesh.geometry.dispose();
    o.mesh.geometry = sector(box, R * 1.0006, Math.max(8, Math.ceil((box[1] - box[0]) * 4)), Math.max(8, Math.ceil((box[3] - box[2]) * 4)));
    o.mesh.visible = true;
    o.id = id;
  }

  // ─── rivers ───────────────────────────────────────────────────────────────

  /**
   * One LineSegments2 per river class. Segments lying on a lake (flagged at build time) are
   * skipped: HydroRIVERS routes flow through lakes as straight connector reaches.
   */
  private addRiverLayer(rc: RiverClassGeometry) {
    const data = this.data();
    let total = 0;
    for (const n of rc.cnt) total += n - 1;
    const P = new Float32Array(total * 6);
    const C = new Float32Array(total * 6);
    const mk = this.mouthKm()?.(rc) ?? null;
    if (this.basinMaxKm.length !== data.basins.length) this.basinMaxKm = new Float32Array(data.basins.length);
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    const rr = R * (1.0009 + rc.cls * 0.00012);
    let o = 0, seg = 0, s = 0;
    for (let i = 0; i < rc.cnt.length; i++) {
      const g = rc.g[i];
      lonLatToVec(data.qx(rc.xy[o * 2]), data.qy(rc.xy[o * 2 + 1]), rr, v); o++;
      for (let k = 1; k < rc.cnt[i]; k++, o++, seg++) {
        lonLatToVec(data.qx(rc.xy[o * 2]), data.qy(rc.xy[o * 2 + 1]), rr, w);
        if (!(rc.wet[seg >> 3] & (1 << (seg & 7)))) {
          P[s * 6] = v.x; P[s * 6 + 1] = v.y; P[s * 6 + 2] = v.z;
          P[s * 6 + 3] = w.x; P[s * 6 + 4] = w.y; P[s * 6 + 5] = w.z;
          C[s * 6] = C[s * 6 + 3] = g;
          if (mk) {
            C[s * 6 + 1] = C[s * 6 + 4] = mk[seg];
            const sb = data.basins[g].sub;
            if (mk[seg] > this.subMaxKm[sb]) this.subMaxKm[sb] = mk[seg];
            if (mk[seg] > this.basinMaxKm[g]) this.basinMaxKm[g] = mk[seg];
          }
          s++;
        }
        v.copy(w);
      }
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(P.subarray(0, s * 6));
    geo.setColors(C.subarray(0, s * 6));
    const mat = new LineMaterial({
      vertexColors: true,
      linewidth: RIVER_WIDTH[rc.cls],
      transparent: true,
      opacity: (this.plain() || this.topActive() ? MOSAIC_RIVER_OPACITY : RIVER_OPACITY)[rc.cls],
      depthWrite: rc.cls > 0
    });
    patchBasinColours(mat, this.basinTex, this.ghost, this.glint, this.glintMix);
    const el = this.host.nativeElement;
    mat.resolution.set(el.clientWidth || 1, el.clientHeight || 1);
    const line = new LineSegments2(geo, mat);
    line.frustumCulled = false;
    line.renderOrder = 2 + rc.cls;
    this.rivers.add(line);
    const layer: RiverLayer = { cls: rc.cls, line, mat, distances: false };
    this.riverLayers.push(layer);
    if (this.ready && this.showFlow()) this.setFlow(true);
    this.invalidate();
  }

  /** Writes every basin's river colour (and alpha) into the lookup texture. */
  private updateBasinColours() {
    if (!this.basinTex) return;
    const data = this.data();
    const lut = this.lut;
    const view = this.view();
    const sel = this.selected();
    const hov = this.hovered;
    const tmp = new THREE.Color();
    const dark = this.dark();
    this.ghost.value.set(dark ? this.colors['darkGhost'] : this.colors['ghost']);
    // Flow glints: water blue over the slate rivers, white on black, a deeper tone of each colour on white.
    const plain = this.plain();
    this.glint.value.set(dark ? this.colors['glintDark'] : plain ? this.colors['glintPlain'] : this.colors['glint']);
    this.glintMix.value = dark ? 0.75 : plain ? 0.25 : 0.85;
    this.writeRevealRows();
    if (this.topActive()) {
      const pal = this.mosaicColors.light;
      const inTop = new Set(this.topOrder());
      const base = new THREE.Color(this.colors['river']);
      data.basins.forEach((b, i) => {
        tmp.copy(inTop.has(i) ? pal[b.mosaic] : base);
        lut.set([tmp.r, tmp.g, tmp.b, 1], i * 4);
      });
    } else if (view === 'story') {
      const pal = this.seaColors[dark ? 'dark' : 'light'];
      data.basins.forEach((b, i) => {
        tmp.copy(pal[b.sub]);
        if (i === hov || i === sel) tmp.offsetHSL(0, 0, dark ? 0.12 : -0.08);
        lut.set([tmp.r, tmp.g, tmp.b, 1], i * 4);
      });
    } else if (view === 'mosaic') {
      const g = this.ground();
      const pal = this.mosaicColors[g];
      const groundC = new THREE.Color(g === 'dark' ? this.colors['darkGround'] : this.colors['mosaicGround']);
      const fade = sel >= 0 ? MOSAIC_FADE : hov >= 0 ? MOSAIC_HOVER_FADE : 0;
      data.basins.forEach((b, i) => {
        tmp.copy(pal[b.mosaic]);
        if (fade && i !== sel && i !== hov) tmp.lerp(groundC, fade);
        lut.set([tmp.r, tmp.g, tmp.b, 1], i * 4);
      });
    } else {
      const base = new THREE.Color(this.colors['river']);
      const active = new THREE.Color(this.colors['riverActive']);
      const dropBasin = view === 'raindrop' ? (this.drop()?.basin ?? -1) : -1;
      data.basins.forEach((_, i) => {
        if (i === sel) tmp.copy(active);
        else if (i === hov) tmp.copy(base).lerp(active, 0.65);
        else if (i === dropBasin) tmp.copy(base).lerp(active, 0.5);
        else tmp.copy(base);
        lut.set([tmp.r, tmp.g, tmp.b, 1], i * 4);
      });
    }
    this.basinTex.needsUpdate = true;
    this.invalidate();
  }

  // ─── "Where the rivers end" ───────────────────────────────────────────────

  /** Starts a story step: the step's sea draws its rivers down to the coast; the camera follows. */
  private startStoryStep(step: number) {
    this.story = { t: step >= 1 && step <= SUB_COUNT ? 0 : 1 };
    const data = this.data();
    if (step >= 1 && step <= SUB_COUNT) {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const b of data.basins) {
        if (b.sub !== step - 1) continue;
        x0 = Math.min(x0, b.bb[0]); x1 = Math.max(x1, b.bb[1]); y0 = Math.min(y0, b.bb[2]); y1 = Math.max(y1, b.bb[3]);
      }
      this.flyToBox(x0, x1, y0, y1);
    } else {
      this.flyTo(this.home);
    }
    this.writeRevealRows();
    this.basinTex.needsUpdate = true;
    this.invalidate();
  }

  /** Starts a countdown step: the step's river draws its network down to the mouth. */
  private startTopStep(step: number) {
    const order = this.topOrder();
    const active = step >= 0;
    this.story = { t: active && step >= 1 && step <= order.length ? 0 : 1 };
    if (active) {
      const id = this.topCurrent();
      if (id >= 0) this.flyToBasin(id);
      else this.flyTo(this.home);
    }
    this.setRiverOpacity();
    this.updateBasinColours();
    this.updateOverlays();
    this.invalidate();
  }

  private setRiverOpacity() {
    const full = this.plain() || this.topActive();
    this.riverLayers.forEach(l => (l.mat.opacity = (full ? MOSAIC_RIVER_OPACITY : RIVER_OPACITY)[l.cls]));
  }

  /**
   * Row 1 of the lookup texture: per basin, the distance to the mouth above which its rivers are
   * drawn (−1 = all) and the ghost opacity of the rest. The two presentations reveal progressively.
   */
  private writeRevealRows() {
    const data = this.data();
    const lut = this.lut;
    const story = this.view() === 'story';
    const step = this.storyStep();
    const t = this.story.t;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const top = this.topActive();
    const order = this.topOrder();
    const topStep = this.topStep();
    const pos = new Map(order.map((id, k) => [id, k + 1]));
    data.basins.forEach((b, i) => {
      let km = -1, ghost = 0;
      if (top && topStep >= 1 && topStep <= order.length) {
        const s = pos.get(i) ?? Infinity; // step that reveals this basin (never, outside the top)
        ghost = STORY_GHOST;
        km = s < topStep ? -1 : s === topStep ? (this.basinMaxKm[i] || 1) * (1 - e) - 0.001 : 1e9;
      } else if (top) {
        // Intro and finale: the top rivers in full, everything else stays a ghost.
        ghost = STORY_GHOST;
        km = pos.has(i) ? -1 : 1e9;
      } else if (story && step < STORY_STEPS - 1) {
        const sea = b.sub + 1; // step that reveals this basin's sea
        ghost = STORY_GHOST;
        km = sea < step ? -1 : sea === step ? this.subMaxKm[b.sub] * (1 - e) - 0.001 : 1e9;
      }
      lut[(BASIN_TEX + i) * 4] = km;
      lut[(BASIN_TEX + i) * 4 + 1] = ghost;
    });
  }

  /** Advances the story reveal; returns true while it is still running. */
  private stepStory(dt: number): boolean {
    const top = this.topActive();
    if ((this.view() !== 'story' && !top) || this.story.t >= 1) return false;
    this.story.t = Math.min(1, this.story.t + dt / (top ? TOP_REVEAL_S : STORY_REVEAL_S));
    this.writeRevealRows();
    this.basinTex.needsUpdate = true;
    return true;
  }

  /** Flow animation: glints travel downstream over the rivers (reaches are stored in flow direction). */
  private setFlow(on: boolean) {
    for (const l of this.riverLayers) {
      if (on && !l.distances) { l.line.computeLineDistances(); l.distances = true; }
      l.mat.dashed = on;
      l.mat.dashSize = 1;
      l.mat.gapSize = FLOW_GAP;
    }
    this.invalidate();
  }

  // ─── borders ──────────────────────────────────────────────────────────────

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

  // ─── raindrop ─────────────────────────────────────────────────────────────

  /** Draws the path of a raindrop and animates it from where it fell to the sea. */
  private showDrop(path: RaindropPath | null) {
    for (const l of [this.dropLine, this.dropHalo]) {
      if (!l) continue;
      this.scene.remove(l);
      l.geometry.dispose();
      (l.material as LineMaterial).dispose();
    }
    this.dropLine = this.dropHalo = undefined;
    this.dropReveal = null;
    this.dropHead = null;
    this.dropRef().nativeElement.style.opacity = '0';
    if (!path || this.view() !== 'raindrop') { this.invalidate(); return; }

    const n = path.points.length / 2;
    const P = new Float32Array((n - 1) * 6);
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    lonLatToVec(path.points[0], path.points[1], R * 1.0018, v);
    for (let i = 1; i < n; i++) {
      lonLatToVec(path.points[i * 2], path.points[i * 2 + 1], R * 1.0018, w);
      P.set([v.x, v.y, v.z, w.x, w.y, w.z], (i - 1) * 6);
      v.copy(w);
    }
    const el = this.host.nativeElement;
    const make = (color: string, width: number, order: number, opacity: number) => {
      const geo = new LineSegmentsGeometry();
      geo.setPositions(P);
      const mat = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: width, transparent: true, opacity, depthWrite: false });
      mat.resolution.set(el.clientWidth || 1, el.clientHeight || 1);
      const line = new LineSegments2(geo, mat);
      line.frustumCulled = false;
      line.renderOrder = order;
      geo.instanceCount = 0;
      this.scene.add(line);
      return line;
    };
    this.dropHalo = make(this.colors['dropHalo'], 7, 11, 0.85);
    this.dropLine = make(this.colors['drop'], 3.5, 12, 1);
    this.dropReveal = { t: 0, dur: clamp(1.8 + path.totalKm / 500, 2, 5), path };

    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < n; i++) {
      x0 = Math.min(x0, path.points[i * 2]); x1 = Math.max(x1, path.points[i * 2]);
      y0 = Math.min(y0, path.points[i * 2 + 1]); y1 = Math.max(y1, path.points[i * 2 + 1]);
    }
    this.flyToBox(x0, x1, y0, y1);
    this.invalidate();
  }

  /** Advances the raindrop reveal; returns true while it is still running. */
  private stepDrop(dt: number): boolean {
    const r = this.dropReveal;
    if (!r || !this.dropLine || !this.dropHalo) return false;
    r.t = Math.min(1, r.t + dt / r.dur);
    const e = r.t < 0.5 ? 2 * r.t * r.t : 1 - Math.pow(-2 * r.t + 2, 2) / 2;
    const target = e * r.path.totalKm;
    const km = r.path.km;
    let i = 1;
    while (i < km.length && km[i] < target) i++;
    const segs = Math.min(km.length - 1, i);
    this.dropLine.geometry.instanceCount = segs;
    this.dropHalo.geometry.instanceCount = segs;
    const p = r.path.points;
    const k = Math.min(segs, km.length - 1);
    this.dropHead = [p[k * 2], p[k * 2 + 1]];
    if (r.t >= 1) this.dropReveal = null;
    return true;
  }

  // ─── labels ───────────────────────────────────────────────────────────────

  private buildLabels() {
    const data = this.data();
    const root = this.labelsRef().nativeElement;
    root.textContent = '';
    this.labels = [];
    const label = this.basinLabel();
    const mk = (text: string, kind: Label['kind'], lon: number, lat: number, maxDist: number) => {
      const el = document.createElement('div');
      el.className = 'globe-label ' + (kind === 'sea' ? 'globe-label--sea' : 'globe-label--river' + (kind === 'big' ? ' globe-label--big' : ''));
      el.textContent = text;
      root.appendChild(el);
      this.labels.push({ el, p: lonLatToVec(lon, lat, R * 1.002), maxDist, w: 0, h: 16, text, kind });
    };
    this.subNames().forEach((name, i) => mk(name, 'sea', data.subs[i].lbl[0], data.subs[i].lbl[1], 99));
    data.basins
      .filter(b => b.kind === 'basin' && b.name && b.lbl)
      .sort((a, b) => b.area - a.area)
      .forEach(b => {
        const big = b.area > 40000;
        mk(label(b).replace(/ \(.+\)$/, ''), big ? 'big' : 'river', b.lbl![0], b.lbl![1], big ? 99 : b.area > 15000 ? R + 5 : R + 2.6);
      });
    for (const L of this.labels) L.w = L.el.offsetWidth || L.text.length * 7;
  }

  private readonly tv = new THREE.Vector3();

  /** Screen position of a world point, or null when it is behind the globe / off screen. */
  private toScreen(p: THREE.Vector3, w: number, h: number): [number, number] | null {
    const camDir = this.look.copy(this.camera.position).normalize();
    if (this.tv.copy(p).normalize().dot(camDir) < 0.25) return null;
    this.tv.copy(p).project(this.camera);
    const x = ((this.tv.x + 1) / 2) * w, y = ((1 - this.tv.y) / 2) * h;
    return x < 0 || x > w || y < 0 || y > h ? null : [x, y];
  }

  private updateLabels(w: number, h: number) {
    const show = this.showLabels();
    const dist = this.camera.position.length();
    const placed: number[][] = [];
    const hide = (L: Label) => {
      if (L.shown !== false) { L.el.style.opacity = '0'; L.shown = false; }
    };
    for (const L of this.labels) {
      const at = show && dist <= L.maxDist ? this.toScreen(L.p, w, h) : null;
      if (!at) { hide(L); continue; }
      const [x, y] = at;
      const bx = [x - L.w / 2 - 3, x + L.w / 2 + 3, y - L.h / 2 - 2, y + L.h / 2 + 2];
      if (placed.some(p => p[0] < bx[1] && bx[0] < p[1] && p[2] < bx[3] && bx[2] < p[3])) { hide(L); continue; }
      placed.push(bx);
      if (L.shown !== true) { L.el.style.opacity = '1'; L.shown = true; }
      const tf = `translate(${Math.round(x)}px,${Math.round(y)}px) translate(-50%,-50%)`;
      if (tf !== L.tf) { L.el.style.transform = tf; L.tf = tf; }
    }
    const drop = this.dropRef().nativeElement;
    const at = this.dropHead ? this.toScreen(lonLatToVec(this.dropHead[0], this.dropHead[1], R * 1.002), w, h) : null;
    drop.style.opacity = at ? '1' : '0';
    if (at) drop.style.transform = `translate(${at[0]}px,${at[1]}px) translate(-50%,-50%)`;
  }

  // ─── picking ──────────────────────────────────────────────────────────────

  /** Basin id at lon/lat, or −1 (used to replay a shared raindrop link). */
  basinAtPoint(lon: number, lat: number): number {
    return this.basinAt(lon, lat);
  }

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
        // Plain hover (mouse, no button held): resolved once per frame in the render loop.
        if (e.pointerType === 'mouse') this.pendingHover = { x: e.clientX, y: e.clientY };
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
        if (!this.dragging) this.setHover(-1, null);
        this.dragging = true;
        canvas.style.cursor = 'grabbing';
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
      if (!at) return;
      const id = this.basinAt(at[0], at[1]);
      this.zone.run(() => this.pick.emit({ id, lon: at[0], lat: at[1] }));
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', () => {
      this.pendingHover = null;
      if (!this.pointers.size) this.setHover(-1, null);
    });

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

  /** Hover preview: highlights the basin under the pointer and reports it for the tooltip. */
  private setHover(id: number, at: { x: number; y: number } | null) {
    const changed = id !== this.hovered;
    if (changed) {
      this.hovered = id;
      this.updateBasinColours();
      if (this.hovOverlay) this.paintOverlay(this.hovOverlay, id !== this.selected() ? id : -1, 'hov');
      this.invalidate();
      this.canvasRef().nativeElement.style.cursor = id >= 0 ? 'pointer' : 'grab';
    }
    if (changed || id >= 0) this.zone.run(() => this.hover.emit(id >= 0 && at ? { id, x: at.x, y: at.y } : null));
  }

  // ─── print ────────────────────────────────────────────────────────────────

  /** On-screen state saved while the map is in print mode (poster maker), or null. */
  private printSaved: { cam: View; pitch: number; fov: number; pr: number; visible: [THREE.Object3D, boolean][] } | null = null;
  private printStyle: PrintStyle | null = null;
  /** Altitude that frames the whole drainage basin, per frame aspect: the reference for line weights. */
  private readonly printWholeAlt = new Map<number, number>();

  /**
   * Puts the map into print mode with `style` until printEnd() (call again to change the style):
   * only the rivers stay in the scene, in the style's colours, on plain white or black for blending.
   * The on-screen loop pauses meanwhile.
   */
  printBegin(style: PrintStyle) {
    if (!this.ready) return;
    if (!this.printSaved) {
      this.fly = null;
      this.printSaved = {
        cam: { ...this.cam }, pitch: this.pitch, fov: this.camera.fov, pr: this.renderer.getPixelRatio(),
        visible: this.scene.children.map(o => [o, o.visible] as [THREE.Object3D, boolean])
      };
    }
    this.printStyle = style;
    for (const o of this.scene.children) o.visible = o === this.rivers;
    this.scene.background = new THREE.Color(style.blend === 'multiply' ? 0xffffff : 0x000000);
    const paper = new THREE.Color(style.paper);
    const c = new THREE.Color();
    const lut = this.lut;
    this.data().basins.forEach((_, i) => {
      c.set(style.riverColors[i] ?? style.riverColors[0] ?? style.paper);
      // Around a single basin, the neighbours' rivers stay as a faint context.
      if (style.focus >= 0 && i !== style.focus) c.lerp(paper, 0.8);
      lut.set([c.r, c.g, c.b, 1], i * 4);
      lut[(BASIN_TEX + i) * 4] = -1;
      lut[(BASIN_TEX + i) * 4 + 1] = 0;
    });
    this.basinTex.needsUpdate = true;
    for (const l of this.riverLayers) l.mat.dashed = false;
  }

  /**
   * Renders the print map into a `width × height` canvas at `dpi` (between printBegin and printEnd).
   * Straight down through a narrow lens, the subject fitted with a small margin. The base map — sea,
   * land, lakes and the drainage divide — is drawn as vectors, so it stays sharp at any scale; the
   * rivers are rendered by WebGL in tiles (a 300 dpi A2 never needs a giant GPU buffer) and laid over
   * it; `glow` adds a soft halo under them (neon); the sea names go on top.
   */
  async printRender(
    width: number,
    height: number,
    dpi: number,
    opts: { glow?: boolean; onProgress?: (done: number) => void } = {}
  ): Promise<HTMLCanvasElement> {
    const style = this.printStyle;
    if (!style) throw new Error('printBegin() first');
    const data = this.data();
    const px = (mm: number) => (mm * dpi) / 25.4;
    const gl = this.renderer.getContext();
    const tile = Math.min(PRINT_TILE, ...(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as number[]));

    // ── camera ──
    this.pitch = 0;
    this.camera.fov = PRINT_FOV;
    this.camera.aspect = width / height;
    this.camera.clearViewOffset();
    const aspectKey = Math.round((width / height) * 1000);
    const whole = this.softOutlines()[6];
    if (!this.printWholeAlt.has(aspectKey)) this.printWholeAlt.set(aspectKey, this.fitPrint(whole));
    const alt = this.fitPrint(style.focus >= 0 ? data.basinPolys[style.focus] : whole);
    // Zoomed in on one basin, rivers draw a little heavier (gently, not to scale).
    const weight = clamp(Math.pow(this.printWholeAlt.get(aspectKey)! / alt, 0.3), 1, 2.4);
    // Balance the sheet: the whole map (base, rivers, sea names) moves right by PRINT_SHIFT_X.
    const dx = Math.round(width * PRINT_SHIFT_X);
    this.camera.setViewOffset(width, height, -dx, 0, width, height);
    this.camera.updateProjectionMatrix();

    // ── base map ──
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d')!;
    this.drawPrintBase(ctx, width, height, style, px);

    // ── rivers ──
    for (const l of this.riverLayers) {
      const w = px(PRINT_RIVER_MM[l.cls]) * weight;
      l.mat.linewidth = Math.max(PRINT_MIN_LINE_PX, w);
      l.mat.opacity = (style.ink ? PRINT_INK_OPACITY : PRINT_COLOUR_OPACITY)[l.cls] * Math.min(1, w / PRINT_MIN_LINE_PX);
    }
    const layer = opts.glow ? document.createElement('canvas') : null;
    if (layer) { layer.width = width; layer.height = height; }
    const lctx = layer ? layer.getContext('2d')! : ctx;
    lctx.globalCompositeOperation = layer ? 'source-over' : style.blend;
    this.renderer.setPixelRatio(1);
    const lineMats = this.riverLayers.map(l => l.mat);
    const tiles = Math.ceil(width / tile) * Math.ceil(height / tile);
    let done = 0;
    for (let ty = 0; ty < height; ty += tile) {
      for (let tx = 0; tx < width; tx += tile) {
        const tw = Math.min(tile, width - tx), th = Math.min(tile, height - ty);
        this.renderer.setSize(tw, th, false);
        this.camera.setViewOffset(width, height, tx - dx, ty, tw, th);
        this.camera.updateProjectionMatrix();
        lineMats.forEach(m => m.resolution.set(tw, th));
        this.renderer.render(this.scene, this.camera);
        lctx.drawImage(this.renderer.domElement, 0, 0, tw, th, tx, ty, tw, th);
        opts.onProgress?.(++done / tiles);
        await nextFrame(); // keep the page responsive between tiles
      }
    }
    this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    if (layer) {
      // Two soft copies of the rivers (shrunk and stretched back = blurred) glow under the sharp ones.
      ctx.globalCompositeOperation = 'screen';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      for (const [f, a] of [[1 / 7, 0.9], [1 / 22, 0.8]] as const) {
        const sm = document.createElement('canvas');
        sm.width = Math.max(1, Math.round(width * f));
        sm.height = Math.max(1, Math.round(height * f));
        const sx = sm.getContext('2d')!;
        sx.imageSmoothingEnabled = true;
        sx.imageSmoothingQuality = 'high';
        sx.drawImage(layer, 0, 0, sm.width, sm.height);
        ctx.globalAlpha = a;
        ctx.drawImage(sm, 0, 0, width, height);
      }
      ctx.globalAlpha = 1;
      ctx.drawImage(layer, 0, 0);
    }
    ctx.globalCompositeOperation = 'source-over';

    // ── sea names: spaced italic caps ──
    if (style.seaNames) {
      const size = px(2.6);
      ctx.font = `italic 300 ${size}px ${this.theme.getFontFamily()}`;
      ctx.letterSpacing = `${size * 0.22}px`;
      ctx.fillStyle = style.seaLabel;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const L of this.labels) {
        if (L.kind !== 'sea') continue;
        const p = L.p.clone().project(this.camera);
        ctx.fillText(L.text.toUpperCase(), ((p.x + 1) / 2) * width + dx, ((1 - p.y) / 2) * height);
      }
      ctx.letterSpacing = '0px';
    }
    return out;
  }

  /** Leaves print mode and restores the on-screen map. */
  async printEnd() {
    const saved = this.printSaved;
    if (!saved) return;
    this.printSaved = null;
    this.printStyle = null;
    for (const [o, v] of saved.visible) o.visible = v;
    this.cam = saved.cam;
    this.pitch = saved.pitch;
    this.camera.fov = saved.fov;
    this.camera.near = 0.005;
    this.camera.far = 400;
    this.renderer.setPixelRatio(saved.pr);
    this.resize();
    this.rivers.visible = this.showRivers();
    if (this.borders) this.borders.visible = this.showBorders();
    this.showDrop(this.drop());
    this.setFlow(this.showFlow());
    await this.restyle();
    if (this.topActive()) this.startTopStep(this.topStep());
    this.invalidate();
  }

  /** Centres the print camera on `rings` and returns the altitude at which they fill ~95 % of the frame. */
  private fitPrint(rings: ArrayLike<number>[]): number {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, n = 0;
    for (const r of rings) n += r.length / 2;
    const step = Math.max(1, Math.floor(n / 1600));
    const pts: THREE.Vector3[] = [];
    for (const r of rings) {
      for (let i = 0; i < r.length; i += 2) {
        x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]);
      }
      for (let i = 0; i < r.length; i += 2 * step) pts.push(lonLatToVec(r[i], r[i + 1], R));
    }
    const t = new THREE.Vector3();
    const extent = () => {
      this.placeCamera();
      this.camera.near = Math.max(0.001, this.cam.alt * 0.5);
      this.camera.far = this.cam.alt + R * 2;
      this.camera.updateProjectionMatrix();
      let ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity;
      for (const p of pts) { t.copy(p).project(this.camera); ax = Math.min(ax, t.x); bx = Math.max(bx, t.x); ay = Math.min(ay, t.y); by = Math.max(by, t.y); }
      return { ax, bx, ay, by };
    };
    this.cam = { lon: (x0 + x1) / 2, lat: (y0 + y1) / 2, alt: 2 };
    // Grow the altitude until the outline fits, then centre on its projected extent; twice.
    for (let pass = 0; pass < 2; pass++) {
      for (let alt = 0.01; alt < 80; alt *= 1.02) {
        this.cam.alt = alt;
        const e = extent();
        if (Math.max(-e.ax, e.bx) < 0.95 && Math.max(-e.ay, e.by) < 0.95) break;
      }
      const e = extent();
      this.cam.lon += (((e.ax + e.bx) / 2) * (x1 - x0) * 0.5) / Math.max(0.2, (e.bx - e.ax) / 2);
      this.cam.lat += (((e.ay + e.by) / 2) * (y1 - y0) * 0.5) / Math.max(0.2, (e.by - e.ay) / 2);
    }
    extent();
    return this.cam.alt;
  }

  /** Sea, land, lakes and the drainage divide as vectors, projected through the print camera. */
  private drawPrintBase(ctx: CanvasRenderingContext2D, W: number, H: number, style: PrintStyle, px: (mm: number) => number) {
    const data = this.data();
    this.camera.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    let first = true;
    const put = (lon: number, lat: number) => {
      const phi = ((lon + 180) / 360) * Math.PI * 2, th = (90 - lat) * DEG, st = Math.sin(th);
      const x = -R * Math.cos(phi) * st, y = R * Math.cos(th), z = R * Math.sin(phi) * st;
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      const X = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * 0.5 * W;
      const Y = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5 * H;
      if (first) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
      first = false;
    };
    // Long straight edges in lon/lat (clip lines along the data box) curve on the globe: subdivide
    // them so neighbouring layers meet where the texture-based map has them meet.
    const edge = (lon0: number, lat0: number, lon1: number, lat1: number) => {
      const n = Math.ceil(Math.max(Math.abs(lon1 - lon0), Math.abs(lat1 - lat0)) / 0.25);
      for (let s = 1; s < n; s++) put(lon0 + ((lon1 - lon0) * s) / n, lat0 + ((lat1 - lat0) * s) / n);
    };
    const ring = (r: ArrayLike<number>) => {
      first = true;
      for (let k = 0; k < r.length; k += 2) {
        if (k) edge(r[k - 2], r[k - 1], r[k], r[k + 1]);
        put(r[k], r[k + 1]);
      }
      if (r.length >= 4) edge(r[r.length - 2], r[r.length - 1], r[0], r[1]);
      ctx.closePath();
    };
    const fill = (polys: ArrayLike<number>[][], colour: string) => {
      ctx.fillStyle = colour;
      for (const poly of polys) { ctx.beginPath(); for (const r of poly) ring(r); ctx.fill('evenodd'); }
    };
    ctx.fillStyle = style.sea;
    ctx.fillRect(0, 0, W, H);
    fill(data.world, style.paper);
    // Inside the data box the detailed coast and lakes replace the coarse world outline.
    const [LON0, LON1, LAT0, LAT1] = data.bbox;
    const box: number[] = [];
    const N = 64;
    for (let i = 0; i <= N; i++) box.push(LON0 + ((LON1 - LON0) * i) / N, LAT0);
    for (let i = 0; i <= N; i++) box.push(LON1, LAT0 + ((LAT1 - LAT0) * i) / N);
    for (let i = N; i >= 0; i--) box.push(LON0 + ((LON1 - LON0) * i) / N, LAT1);
    for (let i = N; i >= 0; i--) box.push(LON0, LAT0 + ((LAT1 - LAT0) * i) / N);
    ctx.save();
    ctx.beginPath();
    ring(box);
    ctx.clip();
    ctx.fillStyle = style.sea;
    ctx.fillRect(0, 0, W, H);
    fill(data.land, style.paper);
    fill(data.lakes, style.sea);
    if (style.lakeLine) {
      ctx.strokeStyle = style.lakeLine;
      ctx.lineWidth = Math.max(0.6, px(0.08));
      ctx.lineJoin = 'round';
      for (const poly of data.lakes) { ctx.beginPath(); for (const r of poly) ring(r); ctx.stroke(); }
    }
    ctx.restore();
    ctx.strokeStyle = style.divide;
    ctx.lineWidth = Math.max(1, px(0.13));
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const r of style.focus >= 0 ? data.basinPolys[style.focus] : this.softOutlines()[6]) ring(r);
    ctx.stroke();
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
    for (const l of [this.dropLine, this.dropHalo]) (l?.material as LineMaterial | undefined)?.resolution.set(w, h);
  }

  private frame = () => {
    this.raf = requestAnimationFrame(this.frame);
    // The poster maker owns the renderer while the map is in print mode.
    if (this.printSaved) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    let animating = false;

    if (this.pendingHover && !this.dragging) {
      const { x, y } = this.pendingHover;
      this.pendingHover = null;
      const at = this.lonLatAt(x, y);
      this.setHover(at ? this.basinAt(at[0], at[1]) : -1, { x, y });
    }
    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + dt / this.fly.dur);
      const e = 1 - Math.pow(1 - this.fly.t, 3);
      const { from, to } = this.fly;
      // Altitude eases geometrically so zooming in and out feel equally paced.
      this.cam = { lon: lerp(from.lon, to.lon, e), lat: lerp(from.lat, to.lat, e), alt: from.alt * Math.pow(to.alt / from.alt, e) };
      if (this.fly.t >= 1) this.fly = null;
      this.motion();
      animating = true;
    }
    if (this.showFlow() && this.showRivers()) {
      this.flowOffset -= dt * FLOW_SPEED;
      animating = true;
    }
    if (this.stepDrop(dt)) animating = true;
    if (this.stepStory(dt)) animating = true;
    if (!this.dirty && !animating) return;
    this.dirty = false;

    this.placeCamera();
    const el = this.host.nativeElement;
    const alt = this.cam.alt;
    this.camera.near = clamp(alt * 0.02, 0.002, 0.5);
    this.camera.updateProjectionMatrix();
    // Rivers thicken gently as you zoom in and stop at a modest width (the big ones turned into
    // ribbons before).
    const wf = clamp(Math.pow(5.6 / alt, 0.3), 0.8, 1.9);
    // World length of one screen pixel at the surface → dash patterns of constant screen size.
    const pxWorld = (alt * 2 * Math.tan((VFOV / 2) * DEG)) / Math.max(1, el.clientHeight);
    for (const l of this.riverLayers) {
      l.mat.linewidth = RIVER_WIDTH[l.cls] * wf;
      if (l.mat.dashed) {
        l.mat.dashScale = 1 / (pxWorld * FLOW_DASH_PX * (1 + FLOW_CLASS_STRETCH * l.cls));
        l.mat.dashOffset = this.flowOffset;
      }
    }
    if (this.borderMat) this.borderMat.dashScale = 1 / (pxWorld * BORDER_DASH_PX);

    this.renderer.render(this.scene, this.camera);
    this.updateLabels(el.clientWidth, el.clientHeight);
  };
}
