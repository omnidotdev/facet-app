import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import type { Mesh } from "./facet";
import type { Theme } from "./theme";

const FACET_AMBER = 0xdd6e33;

const THEME_COLORS: Record<
  Theme,
  { bg: number; grid: number; gridOpacity: number }
> = {
  dark: { bg: 0x0d2033, grid: 0x3a4654, gridOpacity: 0.35 },
  light: { bg: 0xe7e2d8, grid: 0xb7ab90, gridOpacity: 0.6 },
};

/** A Z-up Three.js viewport that renders Facet meshes with flat, faceted shading. */
export class Viewport {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private grid: THREE.GridHelper;
  private current: THREE.Mesh | null = null;

  constructor(
    private container: HTMLElement,
    theme: Theme,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    this.camera.up.set(0, 0, 1); // Z is up, matching the modeling convention
    this.camera.position.set(80, -80, 60);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x62615c, 1.1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(60, -40, 90);
    this.scene.add(key);

    // Blueprint-style ground grid on the XY plane. vertexColors off so a single
    // material color drives every line (lets us recolor it per theme).
    this.grid = new THREE.GridHelper(400, 40);
    this.grid.rotation.x = Math.PI / 2;
    const gridMat = this.grid.material as THREE.LineBasicMaterial;
    gridMat.vertexColors = false;
    gridMat.transparent = true;
    this.scene.add(this.grid);

    this.setTheme(theme);

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.animate();
  }

  /** Recolor background and grid for the active theme. */
  setTheme(theme: Theme): void {
    const c = THEME_COLORS[theme];
    this.scene.background = new THREE.Color(c.bg);
    const gridMat = this.grid.material as THREE.LineBasicMaterial;
    gridMat.color.setHex(c.grid);
    gridMat.opacity = c.gridOpacity;
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  /** Replace the displayed solid. */
  setMesh(mesh: Mesh): void {
    if (this.current) {
      this.scene.remove(this.current);
      this.current.geometry.dispose();
      (this.current.material as THREE.Material).dispose();
      this.current = null;
    }
    if (mesh.triangleCount === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(mesh.positions, 3),
    );
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      color: FACET_AMBER,
      metalness: 0.15,
      roughness: 0.55,
      flatShading: true,
    });
    this.current = new THREE.Mesh(geometry, material);
    this.scene.add(this.current);
    this.frame(geometry);
  }

  /** Point the camera at the model and pull back to fit it. */
  private frame(geometry: THREE.BufferGeometry): void {
    const sphere = geometry.boundingSphere;
    if (!sphere) return;
    const r = Math.max(sphere.radius, 1);
    const dist = r * 3;
    const dir = new THREE.Vector3(1, -1, 0.7).normalize();
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(
      sphere.center.clone().add(dir.multiplyScalar(dist)),
    );
    this.camera.near = r / 100;
    this.camera.far = r * 100;
    this.camera.updateProjectionMatrix();
  }
}
