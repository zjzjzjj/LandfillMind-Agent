/**
 * KernelMeshView · 三维内核真实几何查看器（共享组件）
 *
 * 数据源 = /api/kernel3d/mesh-info/active + /api/kernel3d/mesh/active
 * （Landfill 3D Tool 导出的 OBJ：顶面/坡面/基底三组 + 可选叠加层，顶点色，
 * 开挖台阶保真）。服务端在工程存档更新后会自动重导网格，父页面只需 bump
 * reloadKey 触发刷新。
 *
 * 交互：左键拖拽旋转 / 右键缩放 / 滚轮缩放（与桌面工具提示语一致）；
 * 受控 props 见下。桌面 ⑥三维显示 那一组开关 → zexag / groups / overlayQuery。
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { Loader2 } from 'lucide-react';

export interface MeshInfo {
  vertices?: number; triangles?: number;
  groups?: Record<string, number>;
  /** 叠加层元数据（后端在启用时下发）：{组名: {opacity, kind, verts, faces}} */
  overlays?: Record<string, { opacity?: number; kind?: string }>;
  bounds?: { x: [number, number]; y: [number, number]; z: [number, number] };
}

export type MeshViewPhase = 'loading' | 'ready' | 'empty' | 'error';
export interface MeshStatus { phase: MeshViewPhase; err: string; info: MeshInfo | null; refreshed: boolean }

/** 命令式句柄：工具条的 ↺/↻ 旋转与「适应视野」走它，比模拟鼠标事件可靠 */
export interface MeshApi {
  rotate: (deltaDeg: number) => void;
  fit: () => void;
}

interface Props {
  reloadKey?: number;
  fitToken?: number;               // 父组件 +1 → 重新精确取景（保持当前视角方向）
  wire?: boolean;
  clipOn?: boolean;
  clipFrac?: number;              // 0~1，沿场地 X 向
  /** 图层开关。键可为实体组 top/side/base，也可为叠加组 contour/slip/fs/heat/flood */
  groups?: Record<string, boolean>;
  view?: { kind: 'bird' | 'top' | 'front'; token: number; dAzim?: number } | null;
  /** 垂直夸张（桌面「垂直夸张」Scale 0.5~6，1.0 = 真实比例） */
  zexag?: number;
  /**
   * 叠加层**指令**（不是数据），如
   * `{contour:{n_levels:14}, flood:{level:12}, slip:{}, fs:{}, heat:{}}`。
   * 变化时先 POST 让服务端按它重导网格，再拉 OBJ。
   * 需要算物理的层（slip/fs/heat）由内核复用分析侧构造，前端只给开关与参数。
   */
  overlaySpec?: Record<string, unknown> | null;
  /** 叠加层要用到的分析参数（稳定性 c/φ、沉降土层、开挖分层）；进重导指纹 */
  overlayParams?: Record<string, unknown> | null;
  /** 切走视图时停 rAF，省电省 CPU */
  paused?: boolean;
  /** 命令式句柄回传 */
  apiRef?: { current: MeshApi | null };
  onStatus?: (s: MeshStatus) => void;
}

/** 实体三组（老调用方只认识这三个） */
const GROUP_KEYS = ['top', 'side', 'base'];
/** 叠加组默认不透明度兜底（后端会下发 overlays 元数据，这里只是后备） */
const OVERLAY_FALLBACK_OPACITY: Record<string, number> = {
  contour: 1.0, slip: 0.95, fs: 0.85, heat: 0.85, flood: 0.45,
};

interface St {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  controls: OrbitControls; model: THREE.Group | null; clipPlane: THREE.Plane;
  raf: number; ro: ResizeObserver | undefined; bounds: MeshInfo['bounds'];
  zexag: number; paused: boolean; loop: () => void;
  /** 场景主题相关的可释放对象（主题变化时重建） */
  grid: THREE.GridHelper | null;
}

/**
 * 精确取景：按所选视角在屏幕横/纵向上需要覆盖的半幅（顶视=场地长宽；
 * 轴测/正面=平面对角+坡面投影+堆高），取两向都不被裁的最大距离，margin 5%。
 * 扁平堆体用包围球会浪费 40% 画面，这里让堆体几乎撑满视口。
 */
function fitTo(st: St, kind: 'keep' | 'bird' | 'top' | 'front' = 'keep') {
  const b = st.bounds;
  if (!b) return;
  const zx = st.zexag || 1;
  const cx = (b.x[0] + b.x[1]) / 2, cy = (b.y[0] + b.y[1]) / 2, cz = (b.z[0] + b.z[1]) / 2 * zx;
  const dx = b.x[1] - b.x[0], dy = b.y[1] - b.y[0], dz = (b.z[1] - b.z[0]) * zx;
  const vFov = THREE.MathUtils.degToRad(st.camera.fov);
  const tanV = Math.tan(vFov / 2);
  const tanH = tanV * st.camera.aspect;
  const planDiag = Math.hypot(dx, dy);
  let hExt: number, vExt: number;
  if (kind === 'top') { hExt = dx / 2; vExt = dy / 2; }
  else if (kind === 'front') { hExt = dx / 2; vExt = (dz * 0.9 + dy * 0.12) / 2 + dz * 0.15; }
  else { hExt = planDiag / 2; vExt = (dy * 0.5 + dz * 2.1) / 2; }
  const dirKind = kind === 'keep' ? null : kind;
  const dist = Math.max(hExt / tanH, vExt / tanV) * 1.05;
  let dir: THREE.Vector3;
  if (!dirKind) {
    dir = st.camera.position.clone().sub(st.controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(0.75, 0.55, 0.8);
    dir.normalize();
    // keep：沿用当前视角方向，但按当前俯视角重估纵向需求
    const pitch = Math.abs(dir.y);
    hExt = Math.max(dx, planDiag * (1 - pitch * 0.5)) / 2;
    vExt = (dy * (0.25 + pitch * 0.8) + dz * (2.2 - pitch)) / 2;
    dir.multiplyScalar(Math.max(hExt / tanH, vExt / tanV) * 1.05);
    st.controls.target.set(cx, cz, cy);
    st.camera.position.set(cx + dir.x, cz + dir.y, cy + dir.z);
  } else {
    dir = dirKind === 'top' ? new THREE.Vector3(0, 1, 0.001)
      : dirKind === 'front' ? new THREE.Vector3(0, 0.18, 1)
      : new THREE.Vector3(0.75, 0.55, 0.8);
    dir.normalize().multiplyScalar(dist);
    st.controls.target.set(cx, cz, cy);
    st.camera.position.set(cx + dir.x, cz + dir.y, cy + dir.z);
  }
  // near/far 按**场地尺度**给，而不是按某次取景的距离 —— 相机现在能在
  // 0.03~2.2 倍场宽之间自由缩放，取景距离只是其中一个点。
  // 贴着看时 near 太大会被裁，缩得远时 near 太小又会让深度精度撑不住、
  // 叠加层（抬高 0.1m 量级）互相闪烁。
  const span = Math.max(dx, dy, dz, 1);
  st.camera.near = Math.max(span * 0.004, 0.05);
  st.camera.far = span * 60;
  st.camera.updateProjectionMatrix();
  st.controls.update();
}

/** 绕 target 水平旋转（桌面 ↺ -30° / ↻ +30°） */
function rotateBy(st: St, deltaDeg: number) {
  const off = st.camera.position.clone().sub(st.controls.target);
  if (off.lengthSq() < 1e-9) return;
  off.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deltaDeg));
  st.camera.position.copy(st.controls.target).add(off);
  st.camera.updateProjectionMatrix();
  st.controls.update();
}

/** 取场景主题色（必须读**挂载元素**的 CSS 变量：亮色皮肤是作用域内的） */
function sceneColors(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const g = (k: string, d: string) => (cs.getPropertyValue(k) || '').trim() || d;
  return {
    bg: g('--scene-bg', g('--bg-base', '#0d1525')),
    grid1: g('--scene-grid', '#2a3b55'),
    grid2: g('--scene-grid-2', '#1a2740'),
  };
}

export default function KernelMeshView({
  reloadKey = 0, fitToken = 0, wire = false, clipOn = false, clipFrac = 0.5,
  groups, view, zexag = 1, overlaySpec = null, overlayParams = null,
  paused = false, apiRef, onStatus,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stRef = useRef<St | null>(null);
  const [phase, setPhase] = useState<MeshViewPhase>('loading');
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const emit = useCallback((s: MeshStatus) => { statusRef.current?.(s); }, []);

  const ensureScene = useCallback((bounds: MeshInfo['bounds'] | undefined) => {
    if (stRef.current || !mountRef.current) return stRef.current;
    const el = mountRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const c = sceneColors(el);
    scene.background = new THREE.Color(c.bg);

    const bx = bounds?.x ?? [-200, 200];
    const by = bounds?.y ?? [-150, 150];
    const bz = bounds?.z ?? [0, 30];
    const size = Math.max(bx[1] - bx[0], by[1] - by[0]);
    const cx = (bx[0] + bx[1]) / 2, cy = (by[0] + by[1]) / 2, cz = (bz[0] + bz[1]) / 2;
    // 不做雾化：雾是**按到相机的距离**算的，一缩小整块地形就被背景色糊掉，
    // 越缩越看不清 —— 查看器里这不是想要的效果（用户明确要求去掉）。
    // 远处网格原本靠雾"淡出托底"，现在靠下面的缩放上限把视野圈住就够了。

    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x3a3428, 1.05));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(cx + size * 0.8, cz + size * 0.9, cy - size * 0.5);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x89b7ff, 0.5);
    rim.position.set(cx - size, cz + size * 0.4, cy + size);
    scene.add(rim);

    const grid = new THREE.GridHelper(
      Math.ceil(size * 1.6 / 100) * 100, Math.ceil(size * 1.6 / 50),
      new THREE.Color(c.grid1), new THREE.Color(c.grid2));
    grid.position.set(cx, bz[0] - 0.5, cy);
    scene.add(grid);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, size * 12);
    camera.position.set(cx + size * 0.75, cz + size * 0.55, cy + size * 0.8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(cx, cz, cy);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    // 缩放倍率限制：默认轴测取景距离约 1.0×场宽（见 fitTo），
    // 往外留到 2.2× 足够看清场地与周边网格的关系，再远只是把模型缩成一个点；
    // 往里到 0.03× 够贴近看台阶/坡面细节。
    controls.minDistance = Math.max(size * 0.03, 1);
    controls.maxDistance = size * 2.2;
    // 与桌面提示语一致：左键旋转 · 右键缩放 · 滚轮缩放
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.DOLLY,
    };

    const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), cx);
    const st: St = {
      renderer, scene, camera, controls, model: null as THREE.Group | null,
      clipPlane, raf: 0, ro: undefined as ResizeObserver | undefined, bounds,
      zexag, paused, loop: () => {},
      grid,
    };
    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      fitTo(st, 'keep');   // 容器变了就重新贴边取景（保持视角方向）
    };
    resize();
    st.ro = new ResizeObserver(resize);
    st.ro.observe(el);
    const loop = () => {
      st.raf = requestAnimationFrame(loop);
      if (st.paused) return;      // 切走视图时停渲染，但仍保留 rAF 句柄
      controls.update();
      renderer.render(scene, camera);
    };
    st.loop = loop;
    loop();
    stRef.current = st;
    return st;
  }, []);

  /** 拉 info + OBJ，重建模型组 */
  const load = useCallback(async () => {
    setPhase('loading');
    emit({ phase: 'loading', err: '', info: null, refreshed: false });
    try {
      // 叠加层变了 → 先让服务端按新规格重导（物理层由内核复用分析侧构造）
      let refreshed = false;
      if (overlaySpec && Object.keys(overlaySpec).length) {
        const vr = await fetch('/api/kernel3d/mesh/viewport', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overlay: overlaySpec, params: overlayParams }),
        });
        if (vr.ok) refreshed = Boolean((await vr.json())?.refreshed);
      }
      const infoRes = await fetch('/api/kernel3d/mesh-info/active');
      if (infoRes.status === 422) {
        const msg = (await infoRes.json()).error || '暂无活动三维模型';
        setPhase('empty');
        emit({ phase: 'empty', err: msg, info: null, refreshed: false });
        return;
      }
      const meta: MeshInfo = (await infoRes.json())?.info || {};
      const meshRes = await fetch('/api/kernel3d/mesh/active');
      if (!meshRes.ok) throw new Error(`网格加载失败 HTTP ${meshRes.status}`);
      refreshed = refreshed || meshRes.headers.get('X-Kernel-Refreshed') === '1';
      const parsed = new OBJLoader().parse(await meshRes.text());

      const st = ensureScene(meta.bounds);
      if (!st) return;
      st.bounds = meta.bounds;
      if (st.model) {
        st.scene.remove(st.model);
        st.model.traverse(o => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          // 材质也要释放 —— 只 dispose geometry 会在每次重导时漏一份材质
          const mats = Array.isArray(m.material) ? m.material : (m.material ? [m.material] : []);
          mats.forEach((mm) => mm.dispose());
        });
      }
      parsed.traverse(o => {
        const m = o as THREE.Mesh;
        const name = String(o.name || '').replace(/^g_?/, '');
        const isOverlay = name in OVERLAY_FALLBACK_OPACITY;
        const op = meta.overlays?.[name]?.opacity
          ?? OVERLAY_FALLBACK_OPACITY[name];
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: 0.92, metalness: 0.02,
          side: THREE.DoubleSide, wireframe: wire,
          clippingPlanes: clipOn ? [st.clipPlane] : [],
        });
        if (isOverlay && op != null && op < 1) {
          // OBJ 没有 alpha 通道 —— 叠加层的不透明度只能在这里按组设
          mat.transparent = true;
          mat.opacity = op;
          mat.depthWrite = op >= 0.95;
        }
        m.material = mat;
        if (m.geometry) m.geometry.computeVertexNormals();
      });
      st.model = parsed;
      st.scene.add(parsed);
      applyZexag(st, zexag);
      applyGroups(st, groups, meta);
      fitTo(st, 'bird');   // 新模型载入：贴边取景，消灭四周空白
      setPhase('ready');
      emit({ phase: 'ready', err: '', info: meta, refreshed });
    } catch (e: any) {
      const msg = e?.message ?? '三维查看器异常';
      setPhase('error');
      emit({ phase: 'error', err: msg, info: null, refreshed: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureScene, emit, JSON.stringify(overlaySpec ?? null),
      JSON.stringify(overlayParams ?? null)]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  useEffect(() => {
    const st = stRef.current;
    if (st) st.paused = paused;
  }, [paused]);

  useEffect(() => {
    return () => {
      const st = stRef.current;
      if (st) {
        cancelAnimationFrame(st.raf);
        st.ro?.disconnect();
        st.grid?.geometry.dispose();
        const gm = st.grid?.material;
        if (Array.isArray(gm)) gm.forEach((m) => m.dispose()); else gm?.dispose();
        st.controls.dispose();
        st.renderer.dispose();
        st.renderer.domElement.remove();
        stRef.current = null;
      }
    };
  }, []);

  // 命令式句柄（工具条 ↺/↻ 与适应视野）
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      rotate: (d: number) => { const st = stRef.current; if (st) { rotateBy(st, d); if (st.paused) renderOnce(st); } },
      fit: () => { const st = stRef.current; if (st) { fitTo(st, 'keep'); if (st.paused) renderOnce(st); } },
    };
    return () => { if (apiRef) apiRef.current = null; };
  }, [apiRef]);

  // 材质级受控：线框 / 剖切
  useEffect(() => {
    const st = stRef.current; if (!st?.model) return;
    st.model.traverse(o => {
      const m = o as THREE.Mesh;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat && (o as unknown as { isMesh?: boolean }).isMesh) {
        mat.wireframe = wire;
        mat.clippingPlanes = clipOn ? [st.clipPlane] : [];
        mat.needsUpdate = true;
      }
    });
  }, [wire, clipOn]);
  useEffect(() => {
    const st = stRef.current;
    if (st && clipOn && st.bounds) {
      const [lo, hi] = st.bounds.x;
      st.clipPlane.constant = lo + (hi - lo) * clipFrac;
    }
  }, [clipFrac, clipOn]);
  // 垂直夸张（纯客户端，不触发内核重导）
  useEffect(() => {
    const st = stRef.current; if (!st) return;
    applyZexag(st, zexag);
    fitTo(st, 'keep');
    if (st.paused) renderOnce(st);
  }, [zexag]);
  // 图层开关（实体组 + 叠加组，按实际组名匹配）
  useEffect(() => {
    const st = stRef.current;
    applyGroups(st, groups, null);
    if (st?.paused) renderOnce(st);
  }, [groups]);
  // 视角预设（俯视/平面/正面/适应）：一律按包围盒精确取景
  useEffect(() => {
    const st = stRef.current; if (!st || !view) return;
    if (view.dAzim) rotateBy(st, view.dAzim);
    else fitTo(st, view.kind);
    if (st.paused) renderOnce(st);
  }, [view]);
  useEffect(() => {
    const st = stRef.current; if (!st || !fitToken) return;
    fitTo(st, 'keep');
    if (st.paused) renderOnce(st);
  }, [fitToken]);

  return (
    <div className="relative w-full h-full min-h-0">
      <div ref={mountRef} className="absolute inset-0" />
      {phase === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none"
             style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 80%, transparent)' }}>
          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--primary)' }} />
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>从三维内核拉取真实模型…</p>
        </div>
      )}
    </div>
  );
}

/** 垂直夸张：缩放 Z 并按基底标高做基点补偿（堆体底面不离开地面） */
function applyZexag(st: St, zx: number) {
  const v = Number.isFinite(zx) && zx > 0 ? zx : 1;
  st.zexag = v;
  if (!st.model) return;
  st.model.scale.y = v;
  const z0 = st.bounds?.z?.[0] ?? 0;
  st.model.position.y = z0 * (1 - v);
}

/** 图层显隐。groups 里出现的键全部生效；未列出的组保持可见 */
function applyGroups(st: St | null, groups: Record<string, boolean> | undefined,
                     meta: MeshInfo | null) {
  if (!st?.model || !groups) return;
  const known = new Set([
    ...GROUP_KEYS,
    ...Object.keys(OVERLAY_FALLBACK_OPACITY),
    ...Object.keys(meta?.groups || {}),
    ...Object.keys(meta?.overlays || {}),
  ]);
  st.model.traverse(o => {
    const name = String(o.name || '').replace(/^g_?/, '');
    // 精确组名优先；兼容 OBJLoader 给子网格起的名字（如 "top_0"）
    const key = known.has(name) ? name
      : [...known].find(k => name === k || name.startsWith(k + '_') || name.includes(k));
    if (key && key in groups) o.visible = groups[key] !== false;
  });
}

/** paused 时改完状态补一帧，否则用户看不到变化 */
function renderOnce(st: St) {
  st.controls.update();
  st.renderer.render(st.scene, st.camera);
}
