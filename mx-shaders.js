// WebGL/GLSL reimplementation of MozziDog/BlueArchiveShaders (_MX/MX_C-*):
//   - MX_C-Body     : Half-Lambert smoothstep cel shading, warm shadow tint, Blinn-Phong specular, Fresnel rim, dither clip
//   - MX_C-Face     : MX_C-Body + soft frontal face fill light + rosy anime shadow tint + thinner warm skin outline
//   - MX_C-Hair     : MX_C-Body + Blue Archive angel-ring hair specular band + albedo-tinted hair outline with Z correction
//   - MX_C-EyeMouth : Unshaded crisp tint + alpha test/transparency + dither clip
//   - MX_C-Eyebrow  : Unlit crisp tint + front-facing Z-buffer correction to draw cleanly over hair bangs
//   - MX_C-Halo     : Double-sided unlit luminous tint + dither clip
//   - MX Outline    : Distance-adaptive vertex-normal extrusion (using vertex color alpha if present) + per-part anime ink tint

import * as THREE from "three";

export const MX_DEFAULTS = {
  lightAzimuth: 32,       // degrees around Y
  lightElevation: 48,     // degrees above horizon
  shadowThreshold: 0.38,  // _ShadowThreshold
  lightSharpness: 0.03,   // _LightSharpness
  rimStrength: 0.55,      // _RimStrength
  rimArea: 8.0,           // _RimAreaMultiplier
  hairSpec: 0.18,         // _SpecTopLeveler
  outlineScale: 1.0,      // multiplier on per-part _OutlineWidth
  dither: 0.0,            // _DitherThreshold (0..1)
  grayBrightness: 1.0,    // _GrayBrightness
};

const srgbColor = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

// Shared live uniforms updated across all active MX materials.
export const mxSharedUniforms = {
  uLightDir: { value: new THREE.Vector3(0.42, 0.74, 0.52).normalize() },
  uLightColor: { value: new THREE.Color(1, 1, 1) },
  uTint: { value: srgbColor(1.0, 0.992, 0.965) },
  uBodyShadowTint: { value: srgbColor(0.849, 0.765, 0.693) },
  uFaceShadowTint: { value: srgbColor(0.91, 0.72, 0.70) },
  uHairShadowTint: { value: srgbColor(0.84, 0.74, 0.73) },
  uShadowThreshold: { value: MX_DEFAULTS.shadowThreshold },
  uLightSharpness: { value: MX_DEFAULTS.lightSharpness },
  uRimArea: { value: MX_DEFAULTS.rimArea },
  uRimStrength: { value: MX_DEFAULTS.rimStrength },
  uRimColor: { value: srgbColor(0.88, 0.92, 1.0) },
  uHairSpecLeveler: { value: MX_DEFAULTS.hairSpec },
  uGrayBrightness: { value: MX_DEFAULTS.grayBrightness },
  uCodeMultiplyColor: { value: new THREE.Color(1, 1, 1) },
  uCodeAddColor: { value: new THREE.Color(0, 0, 0) },
  uCodeAddRimColor: { value: new THREE.Color(0, 0, 0) },
  uDitherThreshold: { value: MX_DEFAULTS.dither },
  uOutlineScale: { value: MX_DEFAULTS.outlineScale },
  uModelScale: { value: 1.0 },
};

// Default 1x1 white texture for meshes that don't carry a diffuse map.
const WHITE_TEX = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE_TEX.colorSpace = THREE.SRGBColorSpace;
WHITE_TEX.needsUpdate = true;

export function updateMxLightDirection(azimuthDeg, elevationDeg) {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const cosEl = Math.cos(el);
  mxSharedUniforms.uLightDir.value
    .set(Math.sin(az) * cosEl, Math.sin(el), Math.cos(az) * cosEl)
    .normalize();
  return mxSharedUniforms.uLightDir.value;
}

export function resetMxUniforms() {
  updateMxLightDirection(MX_DEFAULTS.lightAzimuth, MX_DEFAULTS.lightElevation);
  mxSharedUniforms.uShadowThreshold.value = MX_DEFAULTS.shadowThreshold;
  mxSharedUniforms.uLightSharpness.value = MX_DEFAULTS.lightSharpness;
  mxSharedUniforms.uRimStrength.value = MX_DEFAULTS.rimStrength;
  mxSharedUniforms.uRimArea.value = MX_DEFAULTS.rimArea;
  mxSharedUniforms.uHairSpecLeveler.value = MX_DEFAULTS.hairSpec;
  mxSharedUniforms.uOutlineScale.value = MX_DEFAULTS.outlineScale;
  mxSharedUniforms.uDitherThreshold.value = MX_DEFAULTS.dither;
  mxSharedUniforms.uGrayBrightness.value = MX_DEFAULTS.grayBrightness;
}

/**
 * Classify a Blue Archive GLB mesh into one of MozziDog's 6 _MX/MX_C-* shader roles.
 */
export function classifyMxPart(mesh, srcMat, isMouth = false, isHalo = false) {
  const tag = `${mesh.name ?? ""} ${srcMat?.name ?? ""}`;
  if (isHalo || /halo/i.test(tag)) return "halo";
  if (/eyebrow|brow/i.test(tag)) return "eyebrow";
  if (isMouth || /eyemouth|eye_mouth|(^|_)eye($|_|\d)/i.test(tag)) return "eyemouth";
  if (/face/i.test(tag)) return "face";
  if (/hair/i.test(tag)) return "hair";
  return "body";
}

// ---------- Shared GLSL building blocks ----------

const MX_VERTEX_SHADER = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>

uniform float uZCorrection;

varying vec2 vMxUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying vec3 vViewDirWS;
varying vec4 vScreenPos;

void main() {
  vMxUv = uv;

  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>

  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>

  vec4 mxWorldPos = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    mxWorldPos = instanceMatrix * mxWorldPos;
  #endif
  mxWorldPos = modelMatrix * mxWorldPos;
  vWorldPos = mxWorldPos.xyz;

  // Recover world-space normal from inverse-transpose view-space normal (safe for skinning & non-uniform scale).
  vec3 nV = normalize( transformedNormal );
  vWorldNormal = normalize( vec3(
    dot( viewMatrix[0].xyz, nV ),
    dot( viewMatrix[1].xyz, nV ),
    dot( viewMatrix[2].xyz, nV )
  ) );

  vViewDirWS = cameraPosition - vWorldPos;

  // MX_C-Eyebrow Z-buffer correction: gently pull front-facing eyebrows in front of hair bangs.
  if ( uZCorrection > 0.0 ) {
    float frontFace = smoothstep( -0.05, 0.25, dot( vWorldNormal, normalize( vViewDirWS ) ) );
    gl_Position.z -= uZCorrection * frontFace * gl_Position.w;
  }

  vScreenPos = gl_Position;
}
`;

const MX_DITHER_SNIPPET = /* glsl */ `
  if ( uDitherThreshold > 0.001 ) {
    float pseudoRandom = fract( sin( vScreenPos.y / max( abs(vScreenPos.w), 1e-5 ) ) * 43758.5453 ) + 0.01;
    if ( pseudoRandom < uDitherThreshold ) discard;
  }
`;

// Mode constants: 0 = Body, 1 = Face, 2 = Hair, 3 = EyeMouth, 4 = Eyebrow, 5 = Halo
const MX_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uMainTex;
uniform vec3 uBaseColor;
uniform float uAlphaTest;
uniform float uOpacity;
uniform int uPartMode;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uTint;
uniform vec3 uBodyShadowTint;
uniform vec3 uFaceShadowTint;
uniform vec3 uHairShadowTint;
uniform float uShadowThreshold;
uniform float uLightSharpness;

uniform float uRimArea;
uniform float uRimStrength;
uniform vec3 uRimColor;

uniform float uHairSpecLeveler;
uniform float uGrayBrightness;
uniform vec3 uCodeMultiplyColor;
uniform vec3 uCodeAddColor;
uniform vec3 uCodeAddRimColor;
uniform float uDitherThreshold;

varying vec2 vMxUv;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying vec3 vViewDirWS;
varying vec4 vScreenPos;

void main() {
  vec4 albedo = texture2D( uMainTex, vMxUv );
  albedo.rgb *= uBaseColor;
  float alpha = albedo.a * uOpacity;

  if ( uAlphaTest > 0.0 && alpha < uAlphaTest ) discard;
  ${MX_DITHER_SNIPPET}

  vec3 N = normalize( vWorldNormal );
  if ( !gl_FrontFacing ) N = -N;
  vec3 V = normalize( vViewDirWS );
  vec3 L = normalize( uLightDir );

  vec3 finalRgb;

  if ( uPartMode == 5 ) {
    // MX_C-Halo: unlit vibrant tint
    vec3 tinted = albedo.rgb * uTint;
    vec3 baseColor = tinted * uCodeMultiplyColor + uCodeAddColor;
    finalRgb = baseColor * uGrayBrightness;
  } else if ( uPartMode == 4 ) {
    // MX_C-Eyebrow: crisp unlit tint
    vec3 baseColor = albedo.rgb * uTint * uCodeMultiplyColor + uCodeAddColor;
    finalRgb = baseColor * uGrayBrightness;
  } else if ( uPartMode == 3 ) {
    // MX_C-EyeMouth: unshaded by cel shadows so eyes & mouths stay bright and readable
    vec3 tinted = uLightColor * albedo.rgb * uTint;
    vec3 adjusted = tinted * uCodeMultiplyColor + uCodeAddColor;
    finalRgb = adjusted * uGrayBrightness;
  } else {
    float dotResult = dot( L, N );
    float threshold = uShadowThreshold;
    float sharpness = max( uLightSharpness, 0.002 );
    vec3 shadowTint = uBodyShadowTint;
    float rimScale = 1.0;

    if ( uPartMode == 1 ) {
      // MX_C-Face: add soft frontal face fill-light term (MozziDog _ShadowLightDir / _ShadowLightIntensity)
      // Keeps the front of the anime face bright while preserving warm rosy jaw/cheek shadows.
      vec3 faceFillDir = normalize( mix( V, L, 0.35 ) + vec3( 0.0, 0.25, 0.0 ) );
      float faceFill = max( 0.0, dot( faceFillDir, N ) ) * 0.42;
      dotResult += faceFill;
      shadowTint = uFaceShadowTint;
      sharpness = max( sharpness, 0.05 );
      rimScale = 0.45;
    } else if ( uPartMode == 2 ) {
      // MX_C-Hair
      shadowTint = uHairShadowTint;
      rimScale = 0.65;
    }

    float brightness = smoothstep( threshold, threshold + sharpness, (dotResult + 1.0) * 0.5 );
    vec3 shadeTint = brightness * uTint + abs( 1.0 - brightness ) * shadowTint;
    vec3 tintedAlbedo = uLightColor * albedo.rgb * shadeTint;

    vec3 specContrib = vec3( 0.0 );
    if ( uPartMode == 2 && uHairSpecLeveler > 0.001 ) {
      // MX_C-Hair angel-ring specular band (MozziDog _SpecDirMultiplier / _SpecTopArea cutout)
      vec3 specDir = normalize( vec3( L.x * 0.32, 1.25, L.z * 0.32 + 0.12 ) );
      float specRaw = pow( clamp( dot( N, specDir ), 0.0, 1.0 ), 12.0 );
      // Subtle procedural strand variation (fallback when _HairSpecTex is absent in GLB)
      float strand = 0.5 + 0.5 * sin( vMxUv.x * 90.0 + vMxUv.y * 16.0 );
      float normHairSpec = (strand * 2.0 - 1.0) * 0.28;
      float topOrBottom = specRaw * (1.0 + normHairSpec);
      float specVal = (topOrBottom > 0.48) ? (specRaw * 0.08) : (specRaw * 4.0);
      specVal *= brightness;
      specVal = min( specVal, uHairSpecLeveler );
      // Tint hair highlight softly with base hair color + warm white
      specContrib = mix( vec3( 1.0 ), albedo.rgb + vec3( 0.25 ), 0.35 ) * specVal;
    } else if ( uPartMode == 0 ) {
      // MX_C-Body: subtle Blinn-Phong sheen (reduced since GLBs have no metallic _MaskTex.r)
      vec3 H = normalize( L + V );
      float spec = pow( clamp( dot( H, N ), 0.0, 1.0 ), 14.0 ) * 0.06 * brightness;
      specContrib = uLightColor * spec;
    }

    vec3 adjustedAlbedo = (tintedAlbedo + specContrib) * uCodeMultiplyColor + uCodeAddColor;

    // Fresnel rim light
    float rimBase = pow( 1.0 - clamp( dot( N, V ), 0.0, 1.0 ), uRimArea );
    vec3 rimLight = rimBase * uRimColor * (uRimStrength * rimScale);
    rimLight *= (vec3( 1.0 ) + uCodeAddRimColor);

    finalRgb = (adjustedAlbedo + rimLight) * uGrayBrightness;
  }

  gl_FragColor = vec4( finalRgb, alpha );
  #include <colorspace_fragment>
}
`;

// ---------- MX Outline pass (distance-adaptive extrusion + per-part anime ink tint) ----------

const MX_OUTLINE_VERTEX = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>

uniform float uOutlineWidth;
uniform float uOutlineScale;
uniform float uModelScale;
uniform float uOutlineZCorrection;

varying vec2 vMxUv;
varying vec4 vScreenPos;

void main() {
  vMxUv = uv;

  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>

  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>

  vec4 wp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;

  // Distance-adaptive extrusion matching MozziDog's outline pass, normalized by model scale.
  float scale = max( uModelScale, 0.01 );
  float camDist = length( cameraPosition - wp.xyz ) / scale;
  #ifdef USE_COLOR_ALPHA
    float vWeight = color.a;
  #else
    float vWeight = 1.0;
  #endif
  float maxW = uOutlineWidth * uOutlineScale * 0.1 * scale;
  float outlineOffset = min( vWeight * maxW * camDist * camDist * 0.25, maxW );

  vec3 nObj = length( objectNormal ) > 1e-6 ? normalize( objectNormal ) : vec3( 0.0, 1.0, 0.0 );
  transformed += nObj * outlineOffset;

  #include <project_vertex>
  gl_Position.z += uOutlineZCorrection * gl_Position.w;
  vScreenPos = gl_Position;
}
`;

const MX_OUTLINE_FRAGMENT = /* glsl */ `
uniform sampler2D uMainTex;
uniform vec3 uOutlineColor;
uniform float uAlbedoTintMix;
uniform float uDitherThreshold;

varying vec2 vMxUv;
varying vec4 vScreenPos;

void main() {
  ${MX_DITHER_SNIPPET}
  vec3 albedo = texture2D( uMainTex, vMxUv ).rgb;
  // Blend base outline ink with a darkened, slightly warmed version of the surface albedo
  // so every student's hair/clothes get natural anime-colored ink lines.
  vec3 inkFromAlbedo = albedo * vec3( 0.44, 0.36, 0.38 );
  vec3 outColor = mix( uOutlineColor, inkFromAlbedo, uAlbedoTintMix );
  gl_FragColor = vec4( outColor, 1.0 );
  #include <colorspace_fragment>
}
`;

const PART_MODE_ID = {
  body: 0,
  face: 1,
  hair: 2,
  eyemouth: 3,
  eyebrow: 4,
  halo: 5,
};

/**
 * Create a Three.js ShaderMaterial implementing MozziDog's _MX/MX_C-* shader
 * for the classified mesh part.
 */
export function createMxMaterial(srcMat, part) {
  const mode = PART_MODE_ID[part] ?? 0;
  const isHalo = part === "halo";
  const isEyebrow = part === "eyebrow";
  const isTransparent = Boolean(srcMat.transparent);
  const alphaTest = srcMat.alphaTest ?? 0;

  const mat = new THREE.ShaderMaterial({
    name: `MX_${part}_${srcMat.name || "mat"}`,
    vertexShader: MX_VERTEX_SHADER,
    fragmentShader: MX_FRAGMENT_SHADER,
    uniforms: {
      uMainTex: { value: srcMat.map ?? WHITE_TEX },
      uBaseColor: { value: srcMat.color?.clone() ?? new THREE.Color(1, 1, 1) },
      uAlphaTest: { value: alphaTest },
      uOpacity: { value: srcMat.opacity ?? 1.0 },
      uPartMode: { value: mode },
      uZCorrection: { value: isEyebrow ? 0.0028 : 0.0 },

      uLightDir: mxSharedUniforms.uLightDir,
      uLightColor: mxSharedUniforms.uLightColor,
      uTint: mxSharedUniforms.uTint,
      uBodyShadowTint: mxSharedUniforms.uBodyShadowTint,
      uFaceShadowTint: mxSharedUniforms.uFaceShadowTint,
      uHairShadowTint: mxSharedUniforms.uHairShadowTint,
      uShadowThreshold: mxSharedUniforms.uShadowThreshold,
      uLightSharpness: mxSharedUniforms.uLightSharpness,
      uRimArea: mxSharedUniforms.uRimArea,
      uRimStrength: mxSharedUniforms.uRimStrength,
      uRimColor: mxSharedUniforms.uRimColor,
      uHairSpecLeveler: mxSharedUniforms.uHairSpecLeveler,
      uGrayBrightness: mxSharedUniforms.uGrayBrightness,
      uCodeMultiplyColor: mxSharedUniforms.uCodeMultiplyColor,
      uCodeAddColor: mxSharedUniforms.uCodeAddColor,
      uCodeAddRimColor: mxSharedUniforms.uCodeAddRimColor,
      uDitherThreshold: mxSharedUniforms.uDitherThreshold,
    },
    side: isHalo ? THREE.DoubleSide : srcMat.side ?? THREE.FrontSide,
    transparent: isTransparent,
    depthWrite: isTransparent ? Boolean(srcMat.depthWrite) : true,
  });

  mat.userData.isMx = true;
  mat.userData.mxPart = part;
  return mat;
}

/**
 * Create a per-part MX outline material matching MozziDog's Body / Face / Hair outline passes.
 */
export function createMxOutlineMaterial(mesh, srcMat, part) {
  const colorAttr = mesh.geometry?.attributes?.color;
  const hasVColorAlpha = Boolean(colorAttr && colorAttr.itemSize >= 4);

  const presets = {
    face: {
      width: 0.032,
      color: srgbColor(0.68, 0.45, 0.38),
      albedoMix: 0.25,
      zCorr: 0.0002,
    },
    hair: {
      width: 0.052,
      color: srgbColor(0.28, 0.22, 0.25),
      albedoMix: 0.72,
      zCorr: 0.00035,
    },
    body: {
      width: 0.05,
      color: srgbColor(0.24, 0.22, 0.25),
      albedoMix: 0.48,
      zCorr: 0.00015,
    },
  };
  const cfg = presets[part] ?? presets.body;

  const mat = new THREE.ShaderMaterial({
    name: `MX_Outline_${part}`,
    vertexShader: MX_OUTLINE_VERTEX,
    fragmentShader: MX_OUTLINE_FRAGMENT,
    uniforms: {
      uMainTex: { value: srcMat.map ?? WHITE_TEX },
      uOutlineWidth: { value: cfg.width },
      uOutlineScale: mxSharedUniforms.uOutlineScale,
      uModelScale: mxSharedUniforms.uModelScale,
      uOutlineZCorrection: { value: cfg.zCorr },
      uOutlineColor: { value: cfg.color },
      uAlbedoTintMix: { value: cfg.albedoMix },
      uDitherThreshold: mxSharedUniforms.uDitherThreshold,
    },
    vertexColors: hasVColorAlpha,
    side: THREE.BackSide,
  });

  mat.userData.isMxOutline = true;
  return mat;
}

export function isSharedMxTexture(tex) {
  return tex === WHITE_TEX;
}
