/**
 * GLSL for voxel chunk rendering. Built on Three.js shader chunks so the
 * standard directional-light shadow maps and fog work with custom voxel
 * lighting (smooth sky/block light, ambient occlusion, biome tint).
 * @module renderer/shaders/chunkShaders
 */

export const chunkVertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>

in float layer;
in vec4 light;
in vec3 tint;

uniform float uTime;
uniform float uWind;

out vec2 vUv;
flat out float vLayer;
out vec4 vLight;
out vec3 vTint;
out vec3 vNormalW;
out vec3 vWorldPos;

void main() {
  vUv = uv;
  vLayer = layer;
  vLight = vec4(light.x / 60.0, light.y / 60.0, light.z / 3.0, light.w);
  vTint = tint;

  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>

  int flags = int(light.w + 0.5);
  if ((flags & 1) != 0) {
    vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
    float t = uTime * 1.6;
    transformed.x += sin(t + wp0.x * 0.7 + wp0.z * 0.31) * 0.07 * uWind;
    transformed.z += cos(t * 0.87 + wp0.z * 0.63 + wp0.x * 0.2) * 0.055 * uWind;
  }

  #include <project_vertex>
  #include <worldpos_vertex>
  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vNormalW = normalize(mat3(modelMatrix) * objectNormal);
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`;

export const chunkFragmentShader = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

uniform highp sampler2DArray uAtlas;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyLight;
uniform vec3 uBlockLight;
uniform float uMinLight;
uniform float uShadowStrength;
uniform vec3 uSkyReflect;
uniform float uUnderwater;

in vec2 vUv;
flat in float vLayer;
in vec4 vLight;
in vec3 vTint;
in vec3 vNormalW;
in vec3 vWorldPos;

// Perceptual light falloff: level 15 = 1.0, each step darker.
float lightCurve(float l) {
  return l * l * (1.15 - 0.15 * l);
}

void main() {
  int flags = int(vLight.w + 0.5);
  bool isWater = (flags & 4) != 0;
  vec2 uv = vUv;
#ifdef TRANSLUCENT
  if (isWater) uv += vec2(uTime * 0.035, uTime * 0.021);
#endif
  vec4 tex = texture(uAtlas, vec3(uv, vLayer));

#ifdef CUTOUT
  if (tex.a < 0.5) discard;
#endif

  vec3 tintLin = pow(vTint, vec3(2.2));
#ifdef TRANSLUCENT
  vec3 albedo = tex.rgb * tintLin;
  float alpha = tex.a;
  if (isWater) {
    vec4 tex2 = texture(uAtlas, vec3(vUv * 0.73 - vec2(uTime * 0.027, -uTime * 0.018), vLayer));
    albedo = mix(albedo, tex2.rgb * tintLin, 0.5);
  }
#else
  float tintMask = step(tex.a, 0.9);
  vec3 albedo = tex.rgb * mix(vec3(1.0), tintLin, tintMask);
  float alpha = 1.0;
#endif

  vec3 n = normalize(vNormalW);
  float sky = vLight.x;
  float blk = vLight.y;
  float ao = vLight.z;

  float faceShade = n.y > 0.5 ? 1.0 : (n.y < -0.5 ? 0.55 : (abs(n.x) > 0.5 ? 0.74 : 0.86));
  float aoF = mix(0.42, 1.0, ao);
  float skyB = lightCurve(sky);
  float blkB = lightCurve(blk);

  float shadow = getShadowMask();
  float sunVis = smoothstep(0.6, 0.95, sky);

#ifdef TRANSLUCENT
  vec3 surfaceN = n;
  if (isWater && n.y > 0.5) {
    vec2 p = vWorldPos.xz;
    float t = uTime;
    vec2 ripple = vec2(
      sin(p.x * 1.7 + t * 1.9) + sin(p.y * 1.1 - t * 1.3 + p.x * 0.6) * 0.6,
      cos(p.y * 1.5 + t * 1.6) + sin(p.x * 0.8 + p.y * 1.3 + t * 2.3) * 0.6
    ) * 0.045;
    surfaceN = normalize(vec3(ripple.x, 1.0, ripple.y));
  }
  float ndl = max(dot(surfaceN, uSunDir), 0.0);
#else
  float ndl = max(dot(n, uSunDir), 0.0);
#endif

  vec3 ambient = uSkyLight * skyB * faceShade;
  vec3 direct = uSunColor * ndl * mix(1.0, shadow, uShadowStrength) * sunVis;
  vec3 torch = uBlockLight * blkB * faceShade;
  vec3 lighting = max(ambient + direct, torch) * aoF + uMinLight;
  vec3 color = albedo * lighting;

#ifdef TRANSLUCENT
  if (isWater) {
    vec3 V = normalize(cameraPosition - vWorldPos);
    float facing = abs(dot(surfaceN, V));
    float fresnel = pow(1.0 - facing, 4.0) * (1.0 - uUnderwater);
    vec3 reflection = uSkyReflect * (0.35 + 0.65 * skyB);
    color = mix(color, reflection, fresnel * 0.75);
    vec3 R = reflect(-uSunDir, surfaceN);
    float spec = pow(max(dot(R, V), 0.0), 90.0) * sunVis * mix(1.0, shadow, uShadowStrength);
    color += uSunColor * spec * 1.6;
    alpha = clamp(mix(alpha, 1.0, fresnel * 0.6) + spec, 0.0, 1.0);
  }
#endif

  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Depth-only shader for cutout geometry in the shadow pass (alpha tested). */
export const cutoutDepthVertexShader = /* glsl */ `
#include <common>
in float layer;
in vec4 light;
uniform float uTime;
uniform float uWind;
out vec2 vUv;
flat out float vLayer;
void main() {
  vUv = uv;
  vLayer = layer;
  vec3 transformed = position;
  int flags = int(light.w + 0.5);
  if ((flags & 1) != 0) {
    vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
    float t = uTime * 1.6;
    transformed.x += sin(t + wp0.x * 0.7 + wp0.z * 0.31) * 0.07 * uWind;
    transformed.z += cos(t * 0.87 + wp0.z * 0.63 + wp0.x * 0.2) * 0.055 * uWind;
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

export const cutoutDepthFragmentShader = /* glsl */ `
uniform highp sampler2DArray uAtlas;
in vec2 vUv;
flat in float vLayer;
void main() {
  if (texture(uAtlas, vec3(vUv, vLayer)).a < 0.5) discard;
  gl_FragColor = vec4(1.0);
}
`;
