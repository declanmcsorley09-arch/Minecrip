/**
 * GLSL for the procedural sky: gradient dome with sunrise/sunset glow,
 * sun and moon billboards, and twinkling stars.
 * @module renderer/shaders/skyShaders
 */

export const skyVertexShader = /* glsl */ `
out vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

export const skyFragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uGlowColor;
uniform float uGlow;
uniform float uFlash;
in vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  float up = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  // Below the horizon fade to a darker ground tone (visible over oceans / from heights).
  col = mix(col, uGround, smoothstep(0.0, -0.25, h));

  // Sunrise / sunset glow concentrated around the sun's azimuth near the horizon.
  vec3 sunFlat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5);
  vec3 dirFlat = normalize(vec3(dir.x, 0.0, dir.z) + 1e-5);
  float azimuth = max(dot(sunFlat, dirFlat), 0.0);
  float band = exp(-abs(h - 0.02) * 7.0);
  col = mix(col, uGlowColor, uGlow * band * pow(azimuth, 2.5));
  // Soft halo around the sun disc.
  float halo = pow(max(dot(dir, uSunDir), 0.0), 12.0);
  col += uGlowColor * halo * uGlow * 0.35;

  col += vec3(uFlash);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export const celestialVertexShader = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

export const sunFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
in vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float square = max(abs(p.x), abs(p.y));
  float core = 1.0 - smoothstep(0.26, 0.3, square);
  float glow = pow(max(1.0 - length(p), 0.0), 2.2) * 0.9;
  vec3 col = uColor * (core * 1.4 + glow);
  gl_FragColor = vec4(col * uOpacity, 1.0);
  #include <colorspace_fragment>
}
`;

export const moonFragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform float uPhase;
uniform float uOpacity;
in vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p) / 0.42;
  if (r > 1.25) discard;
  float disc = 1.0 - smoothstep(0.96, 1.0, r);
  vec3 tex = texture(uMap, vUv).rgb;
  // Phase lighting on a sphere: the terminator sweeps as the phase advances.
  float angle = uPhase * 6.2831853;
  vec3 L = vec3(sin(angle), 0.0, cos(angle));
  vec2 q = p / 0.42;
  float z = sqrt(max(1.0 - dot(q, q), 0.0));
  float lit = smoothstep(-0.08, 0.12, dot(vec3(q, z), L));
  vec3 col = tex * mix(0.06, 1.0, lit) * disc;
  float glow = pow(max(1.0 - r / 1.25, 0.0), 3.0) * 0.25 * (0.3 + 0.7 * (1.0 - abs(uPhase - 0.5) * 2.0));
  col += vec3(0.6, 0.7, 0.9) * glow;
  gl_FragColor = vec4(col * uOpacity, 1.0);
  #include <colorspace_fragment>
}
`;

export const starVertexShader = /* glsl */ `
in float aSize;
in float aPhase;
uniform float uTime;
out float vTwinkle;
void main() {
  vTwinkle = 0.65 + 0.35 * sin(uTime * (1.5 + aPhase) + aPhase * 17.0);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
  gl_PointSize = aSize;
}
`;

export const starFragmentShader = /* glsl */ `
uniform float uOpacity;
in float vTwinkle;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = max(abs(c.x), abs(c.y));
  float a = (1.0 - smoothstep(0.5, 1.0, d)) * uOpacity * vTwinkle;
  if (a <= 0.01) discard;
  gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * a, 1.0);
  #include <colorspace_fragment>
}
`;
