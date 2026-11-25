import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _col = new THREE.Color();

/**
 * Prepares a primitive BufferGeometry with baked transform and uniform vertex colors
 * so heterogeneous parts can be merged into a single draw call.
 */
export function prepColoredGeometry(srcGeo, colorHex, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const geo = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  if (!geo.attributes.normal) geo.computeVertexNormals();

  _pos.set(position[0] || 0, position[1] || 0, position[2] || 0);
  _euler.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
  _quat.setFromEuler(_euler);
  _scl.set(scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1);
  _mat4.compose(_pos, _quat, _scl);
  geo.applyMatrix4(_mat4);

  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  _col.set(colorHex);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = _col.r;
    colors[i * 3 + 1] = _col.g;
    colors[i * 3 + 2] = _col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export function mergeColoredParts(partSpecs) {
  const prepped = partSpecs.map(spec =>
    prepColoredGeometry(spec.geo, spec.color, spec.pos, spec.rot, spec.scale)
  );
  const merged = mergeGeometries(prepped, false);
  prepped.forEach(g => g.dispose());
  return merged;
}

export function mergePlainParts(partSpecs) {
  const prepped = partSpecs.map(spec => {
    const g = spec.geo.index ? spec.geo.toNonIndexed() : spec.geo.clone();
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (!g.attributes.normal) g.computeVertexNormals();
    _pos.set(spec.pos?.[0] || 0, spec.pos?.[1] || 0, spec.pos?.[2] || 0);
    _euler.set(spec.rot?.[0] || 0, spec.rot?.[1] || 0, spec.rot?.[2] || 0);
    _quat.setFromEuler(_euler);
    _scl.set(spec.scale?.[0] ?? 1, spec.scale?.[1] ?? 1, spec.scale?.[2] ?? 1);
    _mat4.compose(_pos, _quat, _scl);
    g.applyMatrix4(_mat4);
    return g;
  });
  const merged = mergeGeometries(prepped, false);
  prepped.forEach(g => g.dispose());
  return merged;
}
