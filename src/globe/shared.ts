import * as THREE from 'three';

/** Uniform objects shared by every material so one write updates every pass. */
export interface Shared {
  time: THREE.IUniform<number>;
  cursor: THREE.IUniform<number>;
  trail: THREE.IUniform<number>;
  ramp: THREE.IUniform<number>;
  timeOn: THREE.IUniform<number>;
  glow: THREE.IUniform<THREE.Vector3>;
  core: THREE.IUniform<THREE.Vector3>;
  fog: THREE.IUniform<THREE.Vector3>;
  deep: THREE.IUniform<THREE.Vector3>;
  spec: THREE.IUniform<number>;
  res: THREE.IUniform<THREE.Vector2>;
  px: THREE.IUniform<number>;
  camDir: THREE.IUniform<THREE.Vector3>;
  camDist: THREE.IUniform<number>;
}

export function createShared(): Shared {
  return {
    time: { value: 0 },
    cursor: { value: 1 },
    trail: { value: 0.17 },
    ramp: { value: 0.022 },
    timeOn: { value: 0 },
    glow: { value: new THREE.Vector3() },
    core: { value: new THREE.Vector3() },
    fog: { value: new THREE.Vector3() },
    deep: { value: new THREE.Vector3() },
    spec: { value: 0.5 },
    res: { value: new THREE.Vector2(1, 1) },
    px: { value: 1 },
    camDir: { value: new THREE.Vector3(0, 0, 1) },
    camDist: { value: 3 },
  };
}
