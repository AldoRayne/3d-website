import * as THREE from 'three'

export const foliageUniforms = {
  uSeeFrom: { value: new THREE.Vector3() },
  uSeeTo: { value: new THREE.Vector3() },
  uSeeStrength: { value: 0 },
  uSeeRadius: { value: 1.6 },
  uSeeNear: { value: 2.4 },
  uSeeCell: { value: 1 },
}

const VERTEX_HEAD = /* glsl */ `
varying vec3 vSeeWorld;
`

const VERTEX_BODY = /* glsl */ `
  vec4 seeWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    seeWorld = instanceMatrix * seeWorld;
  #endif
  vSeeWorld = (modelMatrix * seeWorld).xyz;
`

const FRAGMENT_HEAD = /* glsl */ `
varying vec3 vSeeWorld;
uniform vec3 uSeeFrom;
uniform vec3 uSeeTo;
uniform float uSeeStrength;
uniform float uSeeRadius;
uniform float uSeeNear;
uniform float uSeeCell;

float seeBayer(vec2 p) {
  ivec2 i = ivec2(mod(floor(p / uSeeCell), 4.0));
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[i.x + i.y * 4] + 0.5) / 16.0;
}
`

const FRAGMENT_BODY = /* glsl */ `
  if (uSeeStrength > 0.0) {
    vec3 seeLine = uSeeTo - uSeeFrom;
    float seeT = dot(vSeeWorld - uSeeFrom, seeLine) / max(dot(seeLine, seeLine), 1e-4);
    float seeDistance = distance(vSeeWorld, uSeeFrom + seeLine * clamp(seeT, 0.0, 1.0));
    float seeTube = (1.0 - smoothstep(uSeeRadius * 0.45, uSeeRadius, seeDistance)) * (1.0 - smoothstep(0.85, 1.05, seeT));
    float seeClose = 1.0 - smoothstep(uSeeNear * 0.55, uSeeNear, distance(vSeeWorld, uSeeFrom));
    float seeCut = max(seeTube, seeClose) * uSeeStrength * 0.82;
    if (seeCut > seeBayer(gl_FragCoord.xy)) discard;
  }
`

export function seeThrough(material: THREE.Material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, foliageUniforms)
    shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`)
    shader.fragmentShader = FRAGMENT_HEAD + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAGMENT_BODY}`)
  }
  material.customProgramCacheKey = () => 'dw-see-through'
  return material
}
