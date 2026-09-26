import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../utils/math.js';

/**
 * Derives every time-of-day / weather dependent visual parameter (sky
 * gradient, fog, sun and moon lighting, cloud tint, star visibility,
 * underwater fog) and pushes them to the renderer, chunk materials, sky and
 * clouds.
 */

const c = (hex) => new THREE.Color(hex);

const PALETTE = {
  dayZenith: c(0x5f9bff),
  dayHorizon: c(0xb9d5ff),
  nightZenith: c(0x02030b),
  nightHorizon: c(0x0b1128),
  sunsetZenith: c(0x3d4f8c),
  rainZenith: c(0x5f6772),
  rainHorizon: c(0x8e969f),
  glowLow: c(0xff5a1f),
  glowHigh: c(0xffb36b),
  sunLow: c(0xff9a55),
  sunHigh: c(0xfff1dc),
  moon: c(0x8ea7ff),
  dayAmbient: new THREE.Color(0.42, 0.47, 0.58),
  nightAmbient: new THREE.Color(0.045, 0.05, 0.1),
  sunsetAmbient: new THREE.Color(0.42, 0.33, 0.3),
  blockLight: new THREE.Color(1.05, 0.83, 0.6),
  underwater: c(0x1a4bb0),
  cloudDay: new THREE.Color(1, 1, 1),
  cloudNight: new THREE.Color(0.018, 0.02, 0.034),
  cloudSunset: c(0xffb48a),
  cloudRain: new THREE.Color(0.45, 0.47, 0.5),
};

/**
 * @typedef {object} AtmosphereState
 * @property {THREE.Vector3} sunDir direction toward the sun
 * @property {number} sunAngle
 * @property {THREE.Color} zenith
 * @property {THREE.Color} horizon
 * @property {THREE.Color} ground
 * @property {THREE.Color} glowColor
 * @property {number} glow sunrise/sunset strength
 * @property {number} flash lightning flash brightness
 * @property {THREE.Color} fogColor
 * @property {number} fogNear
 * @property {number} fogFar
 * @property {number} starVisibility
 * @property {number} celestialVisibility
 * @property {THREE.Color} sunDiscColor
 * @property {THREE.Vector3} lightDir active light direction (sun or moon)
 * @property {THREE.Color} lightColor light colour × intensity
 * @property {THREE.Color} skyAmbient
 * @property {number} shadowStrength
 * @property {THREE.Color} cloudColor
 * @property {number} cloudCoverage
 * @property {number} moonPhase
 * @property {number} underwater
 */

export class Atmosphere {
  constructor() {
    /** @type {AtmosphereState} */
    this.state = {
      sunDir: new THREE.Vector3(0, 1, 0),
      sunAngle: 0,
      zenith: new THREE.Color(),
      horizon: new THREE.Color(),
      ground: new THREE.Color(),
      glowColor: new THREE.Color(),
      glow: 0,
      flash: 0,
      fogColor: new THREE.Color(),
      fogNear: 50,
      fogFar: 120,
      starVisibility: 0,
      celestialVisibility: 1,
      sunDiscColor: new THREE.Color(),
      lightDir: new THREE.Vector3(0, 1, 0),
      lightColor: new THREE.Color(),
      skyAmbient: new THREE.Color(),
      shadowStrength: 0.8,
      cloudColor: new THREE.Color(),
      cloudCoverage: 0.45,
      moonPhase: 0,
      underwater: 0,
    };
    this.flash = 0;
    this.tmpColor = new THREE.Color();
    this.tmpColor2 = new THREE.Color();
    this.viewFlat = new THREE.Vector3();
    this.sunFlat = new THREE.Vector3();
  }

  /**
   * Computes the atmosphere for this frame.
   * @param {number} dt seconds
   * @param {import('../world/DayNightCycle.js').DayNightCycle} cycle
   * @param {import('../world/Weather.js').Weather} weather
   * @param {object} ctx
   * @param {number} ctx.renderDistance chunks
   * @param {boolean} ctx.underwater camera inside water
   * @param {THREE.Vector3} ctx.viewDir camera forward vector
   * @param {number} [ctx.cameraSkyLight=1] 0..1 sky exposure at the camera (caves)
   */
  update(dt, cycle, weather, ctx) {
    const s = this.state;
    cycle.sunDirection(s.sunDir);
    s.sunAngle = cycle.sunAngle;
    s.moonPhase = cycle.moonPhase;
    const e = cycle.sunElevation;
    const rain = weather.rain;
    const dayF = smoothstep(-0.18, 0.22, e);
    const twilight = 1 - smoothstep(0.0, 0.34, Math.abs(e));

    // Sky gradient.
    s.zenith.copy(PALETTE.nightZenith).lerp(PALETTE.dayZenith, dayF);
    s.zenith.lerp(PALETTE.sunsetZenith, twilight * 0.3 * dayF);
    s.horizon.copy(PALETTE.nightHorizon).lerp(PALETTE.dayHorizon, dayF);
    const rainBrightness = 0.1 + 0.9 * dayF;
    s.zenith.lerp(this.tmpColor.copy(PALETTE.rainZenith).multiplyScalar(rainBrightness), rain * 0.85);
    s.horizon.lerp(this.tmpColor.copy(PALETTE.rainHorizon).multiplyScalar(rainBrightness), rain * 0.85);
    s.ground.copy(s.horizon).multiplyScalar(0.45);
    s.glow = twilight * (1 - rain * 0.85);
    s.glowColor.copy(PALETTE.glowLow).lerp(PALETTE.glowHigh, clamp(e * 3 + 0.4, 0, 1));

    // Lightning.
    if (weather.lightningStruck) this.flash = 1;
    this.flash = Math.max(0, this.flash - dt * 3.5);
    s.flash = this.flash * 0.35;

    // Fog: horizon colour, tinted toward the sunset glow when facing the sun.
    this.viewFlat.set(ctx.viewDir.x, 0, ctx.viewDir.z).normalize();
    this.sunFlat.set(s.sunDir.x, 0, s.sunDir.z).normalize();
    const facingSun = Math.pow(Math.max(0, this.viewFlat.dot(this.sunFlat)), 2.5);
    s.fogColor.copy(s.horizon).lerp(s.glowColor, s.glow * facingSun * 0.55);
    const far = Math.max(32, ctx.renderDistance * 16 * 0.92);
    s.fogFar = far * (1 - rain * 0.25);
    s.fogNear = s.fogFar * (0.5 - rain * 0.25);

    // Celestial bodies.
    s.starVisibility = (1 - smoothstep(-0.25, 0.05, e)) * (1 - rain);
    s.celestialVisibility = 1 - rain * 0.95;
    s.sunDiscColor.copy(PALETTE.sunLow).lerp(PALETTE.sunHigh, smoothstep(0, 0.35, e));

    // Direct light: sun by day, moon by night.
    const sunI = smoothstep(-0.02, 0.24, e) * 0.95 * (1 - rain * 0.8);
    const moonBrightness = 0.5 + 0.5 * (1 - Math.abs(s.moonPhase - 4) / 4);
    const moonI = smoothstep(0.02, -0.24, e) * 0.14 * moonBrightness * (1 - rain * 0.8);
    if (e > 0) {
      s.lightDir.copy(s.sunDir);
      s.lightColor.copy(PALETTE.sunLow).lerp(PALETTE.sunHigh, smoothstep(0, 0.4, e)).multiplyScalar(sunI);
    } else {
      s.lightDir.copy(s.sunDir).negate();
      s.lightColor.copy(PALETTE.moon).multiplyScalar(moonI);
    }
    s.shadowStrength = 0.85 * (1 - rain * 0.85);

    s.skyAmbient.copy(PALETTE.nightAmbient).lerp(PALETTE.dayAmbient, dayF);
    s.skyAmbient.lerp(PALETTE.sunsetAmbient, twilight * dayF * 0.35);
    s.skyAmbient.multiplyScalar(1 - rain * 0.3);
    s.skyAmbient.addScalar(s.flash * 0.6);

    // Clouds.
    s.cloudColor.copy(PALETTE.cloudNight).lerp(PALETTE.cloudDay, dayF);
    s.cloudColor.lerp(PALETTE.cloudSunset, twilight * dayF * 0.55);
    s.cloudColor.lerp(this.tmpColor2.copy(PALETTE.cloudRain).multiplyScalar(rainBrightness), rain * 0.8);
    s.cloudCoverage = 0.42 + rain * 0.45;

    // Underwater overrides fog entirely.
    s.underwater = ctx.underwater ? 1 : 0;
    if (ctx.underwater) {
      s.fogColor.copy(PALETTE.underwater).multiplyScalar(0.15 + 0.85 * dayF);
      s.fogNear = 0.5;
      s.fogFar = 22;
    }
  }

  /**
   * Pushes the computed state into render objects.
   * @param {import('./Renderer.js').Renderer} renderer
   * @param {import('./ChunkMaterials.js').ChunkMaterials} materials
   */
  apply(renderer, materials) {
    const s = this.state;
    const fog = renderer.scene.fog;
    fog.color.copy(s.fogColor);
    fog.near = s.fogNear;
    fog.far = s.fogFar;
    renderer.scene.background.copy(s.fogColor);

    renderer.sun.color.copy(s.lightColor).multiplyScalar(1 / Math.max(1e-4, Math.max(s.lightColor.r, s.lightColor.g, s.lightColor.b)));
    renderer.sun.intensity = Math.PI * Math.max(s.lightColor.r, s.lightColor.g, s.lightColor.b);
    renderer.ambient.color.copy(s.skyAmbient);
    renderer.ambient.groundColor.copy(s.skyAmbient).multiplyScalar(0.55);
    renderer.ambient.intensity = Math.PI;

    const u = materials.shared;
    u.uSunDir.value.copy(s.lightDir);
    u.uSunColor.value.copy(s.lightColor);
    u.uSkyLight.value.copy(s.skyAmbient);
    u.uBlockLight.value.copy(PALETTE.blockLight);
    u.uShadowStrength.value = s.shadowStrength;
    u.uSkyReflect.value.copy(s.horizon).lerp(s.zenith, 0.45);
    u.uUnderwater.value = s.underwater;
  }
}
