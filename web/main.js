const PASSES = [
  {
    label: "Mtsdf pass 01",
    duration: 2.3,
    fx: { displacement: 0.32, chroma: 0.1, blur: 0.06, pixelate: 0.0 },
  },
  {
    label: "Mtsdf pass 02",
    duration: 2.6,
    fx: { displacement: 0.82, chroma: 0.72, blur: 0.24, pixelate: 0.18 },
  },
  {
    label: "Mtsdf pass 03",
    duration: 2.2,
    fx: { displacement: 0.95, chroma: 0.88, blur: 0.16, pixelate: 0.58 },
  },
  {
    label: "Recovery",
    duration: 3.2,
    fx: { displacement: 0.07, chroma: 0.02, blur: 0.01, pixelate: 0.0 },
  },
];

const SETTINGS = {
  displacementGain: 1.0,
  chromaGain: 1.0,
  blurGain: 1.0,
  pixelateGain: 1.0,
  globalFx: false,
  trailDecay: 0.09,
  trailFeedback: 0.88,
  trailBlurPx: 1.2,
  trailAdvection: 0.45,
  trailOpacity: 0.18,
  trailRadius: 0.06,
  trailStretch: 0.45,
  trailSpacing: 0.42,
  tipBoost: 2.2,
  trailTextureMix: 0.6,
  trailGhost: 0.52,
  lensRadius: 0.18,
  lensEdgeSoftness: 0.05,
  lensDisplacement: 1.5,
  lensChroma: 1.45,
};

const SHADER = /* wgsl */ `
struct VertexOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
}

struct FxUniform {
  resolution_time_displacement : vec4<f32>,
  chroma_pixelate_blur_mix : vec4<f32>,
  mouse_current_prev : vec4<f32>,
  mouse_params : vec4<f32>,
}

@group(0) @binding(0) var source_tex : texture_2d<f32>;
@group(0) @binding(1) var source_sampler : sampler;
@group(0) @binding(2) var<uniform> fx : FxUniform;
@group(0) @binding(3) var trail_tex : texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  let pos = positions[vertex_index];
  var out : VertexOut;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
  return out;
}

fn sample_safe(uv: vec2<f32>) -> vec3<f32> {
  let clamped = clamp(uv, vec2<f32>(0.001), vec2<f32>(0.999));
  return textureSample(source_tex, source_sampler, clamped).rgb;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let resolution = fx.resolution_time_displacement.xy;
  let time = fx.resolution_time_displacement.z;
  let displacement = fx.resolution_time_displacement.w;
  let chroma = fx.chroma_pixelate_blur_mix.x;
  let pixelate = fx.chroma_pixelate_blur_mix.y;
  let blur_amount = fx.chroma_pixelate_blur_mix.z;
  let mix_strength = fx.chroma_pixelate_blur_mix.w;

  let mouse_uv = fx.mouse_current_prev.xy;
  let mouse_prev_uv = fx.mouse_current_prev.zw;
  let mouse_radius = max(0.02, fx.mouse_params.x);
  let mouse_strength = clamp(fx.mouse_params.y, 0.0, 1.0);
  let mouse_velocity = clamp(fx.mouse_params.z, 0.0, 1.0);
  let mouse_down = clamp(fx.mouse_params.w, 0.0, 1.0);

  let px = vec2<f32>(1.0 / resolution.x, 1.0 / resolution.y);
  let trail_value = textureSample(trail_tex, source_sampler, in.uv).r;
  let trail_dx = textureSample(trail_tex, source_sampler, in.uv + vec2<f32>(px.x * 2.0, 0.0)).r -
                 textureSample(trail_tex, source_sampler, in.uv - vec2<f32>(px.x * 2.0, 0.0)).r;
  let trail_dy = textureSample(trail_tex, source_sampler, in.uv + vec2<f32>(0.0, px.y * 2.0)).r -
                 textureSample(trail_tex, source_sampler, in.uv - vec2<f32>(0.0, px.y * 2.0)).r;

  let dist_to_mouse = distance(in.uv, mouse_uv);
  let tip_influence = exp(-pow(dist_to_mouse / (mouse_radius * 0.48), 2.0) * 3.8) * mouse_strength;
  let trail_influence = clamp(pow(trail_value, 0.7) * (0.68 + mouse_strength * 0.85), 0.0, 1.25);
  let influence = clamp(trail_influence + tip_influence * 0.22, 0.0, 1.45);

  let local_displacement = displacement * influence * 2.2;
  let local_chroma = chroma * influence * 2.25;
  let local_pixelate = clamp(pixelate * influence * 2.2, 0.0, 1.0);
  let local_blur = clamp((blur_amount * influence * 2.0) + mouse_down * influence * 0.08, 0.0, 1.0);

  let pixel_size = max(1.0, mix(1.0, 22.0, local_pixelate));
  let snapped_uv = floor(in.uv * resolution / pixel_size) * pixel_size / resolution;

  let motion = mouse_uv - mouse_prev_uv;
  let motion_len = length(motion);
  var motion_dir = vec2<f32>(0.0, 0.0);
  if (motion_len > 1e-5) {
    motion_dir = motion / motion_len;
  }

  let trail_flow = vec2<f32>(trail_dx, trail_dy) * 0.044 * influence;
  let interactive_offset =
    motion_dir * (0.003 + mouse_velocity * 0.008) * (tip_influence * 0.55 + trail_influence * 0.45) +
    trail_flow;

  let offset = interactive_offset * (1.0 + local_displacement);
  let base_uv = snapped_uv + offset;

  let chroma_shift = vec2<f32>(0.0055 * local_chroma, 0.0);
  var color = vec3<f32>(
    sample_safe(base_uv + chroma_shift).r,
    sample_safe(base_uv).g,
    sample_safe(base_uv - chroma_shift).b
  );

  let blur_px = px * (1.0 + local_blur * 9.0);
  let blurred =
    sample_safe(base_uv + vec2<f32>( blur_px.x, 0.0)) +
    sample_safe(base_uv - vec2<f32>( blur_px.x, 0.0)) +
    sample_safe(base_uv + vec2<f32>(0.0,  blur_px.y)) +
    sample_safe(base_uv - vec2<f32>(0.0,  blur_px.y)) +
    sample_safe(base_uv);
  color = mix(color, blurred / 5.0, local_blur);

  let contrast = 1.02 + local_displacement * 0.16;
  let graded = (color - 0.5) * contrast + 0.5;
  let global_baseline = mix_strength * 0.18;
  let local_mix = clamp(max(influence * 1.2, global_baseline), 0.0, 1.0);
  let final_color = mix(sample_safe(in.uv), graded, local_mix);

  return vec4<f32>(final_color, 1.0);
}
`;

const canvas = document.querySelector("#fx-canvas");
const sourceLayer = document.querySelector("#source-layer");
const hudPass = document.querySelector("#hud-pass");
const hudWebgpu = document.querySelector("#hud-webgpu");
const passLabel = document.querySelector(".pass-label");

const sourceCanvas = document.createElement("canvas");
const sourceCtx = sourceCanvas.getContext("2d");
const trailCanvas = document.createElement("canvas");
const trailCtx = trailCanvas.getContext("2d");
const trailTempCanvas = document.createElement("canvas");
const trailTempCtx = trailTempCanvas.getContext("2d");

let sourceTexture = null;
let trailTexture = null;
let sampler = null;
let bindGroup = null;
let presentationFormat = null;
let pipeline = null;
let uniformBuffer = null;
let device = null;
let queue = null;
let context = null;
let lastPassLabel = "";

const uniformFloats = new Float32Array(16);
const uniformBytes = uniformFloats.byteLength;
const pointer = {
  x: 0.5,
  y: 0.5,
  prevX: 0.5,
  prevY: 0.5,
  targetX: 0.5,
  targetY: 0.5,
  radius: 0.115,
  strength: 0.0,
  targetStrength: 0.0,
  velocity: 0.0,
  inside: false,
  down: false,
};
const trailHistory = [];
const MAX_TRAIL_HISTORY = 42;

init().catch((error) => {
  console.error(error);
  showFallback(`WebGPU init failed: ${String(error)}`);
});

async function init() {
  updateWebGpuStatus();
  setupControls();

  if (!navigator.gpu) {
    showFallback("WebGPU is not available in this browser.");
    return;
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    showFallback("No suitable WebGPU adapter was found.");
    return;
  }

  device = await adapter.requestDevice();
  queue = device.queue;

  context = canvas.getContext("webgpu");
  presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  const shaderModule = device.createShaderModule({ label: "dom-fx-shader", code: SHADER });

  pipeline = device.createRenderPipeline({
    label: "dom-fx-pipeline",
    layout: "auto",
    vertex: { module: shaderModule, entryPoint: "vs_main" },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format: presentationFormat }],
    },
    primitive: { topology: "triangle-list" },
  });

  uniformBuffer = device.createBuffer({
    label: "fx-uniform-buffer",
    size: uniformBytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  resize();
  sourceLayer.style.opacity = "0";
  installPointerHandlers();
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);
}

function resize() {
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const width = Math.max(1, Math.floor(window.innerWidth * dpr));
  const height = Math.max(1, Math.floor(window.innerHeight * dpr));

  if (canvas.width === width && canvas.height === height) {
    return;
  }

  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;

  context.configure({
    device,
    format: presentationFormat,
    alphaMode: "premultiplied",
  });

  sourceCanvas.width = width;
  sourceCanvas.height = height;
  trailCanvas.width = width;
  trailCanvas.height = height;
  trailTempCanvas.width = width;
  trailTempCanvas.height = height;

  trailCtx.setTransform(1, 0, 0, 1, 0, 0);
  trailCtx.fillStyle = "black";
  trailCtx.fillRect(0, 0, trailCanvas.width, trailCanvas.height);
  trailTempCtx.setTransform(1, 0, 0, 1, 0, 0);
  trailTempCtx.fillStyle = "black";
  trailTempCtx.fillRect(0, 0, trailTempCanvas.width, trailTempCanvas.height);

  sourceTexture = device.createTexture({
    label: "source-dom-texture",
    size: [width, height, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  trailTexture = device.createTexture({
    label: "trail-field-texture",
    size: [width, height, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });

  bindGroup = device.createBindGroup({
    label: "dom-fx-bind-group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sourceTexture.createView() },
      { binding: 1, resource: sampler },
      { binding: 2, resource: { buffer: uniformBuffer } },
      { binding: 3, resource: trailTexture.createView() },
    ],
  });
}

function frame(nowMs) {
  const now = nowMs * 0.001;
  const passSample = samplePass(now);

  updatePointerState();
  updateHud(passSample);

  drawSourceLayerToCanvas(sourceCtx, sourceCanvas, sourceLayer);
  updateTrailField();

  queue.copyExternalImageToTexture(
    { source: sourceCanvas },
    { texture: sourceTexture },
    [sourceCanvas.width, sourceCanvas.height],
  );

  queue.copyExternalImageToTexture(
    { source: trailCanvas },
    { texture: trailTexture },
    [trailCanvas.width, trailCanvas.height],
  );

  uniformFloats[0] = canvas.width;
  uniformFloats[1] = canvas.height;
  uniformFloats[2] = now;
  uniformFloats[3] = passSample.fx.displacement * SETTINGS.displacementGain;
  uniformFloats[4] = passSample.fx.chroma * SETTINGS.chromaGain;
  uniformFloats[5] = passSample.fx.pixelate * SETTINGS.pixelateGain;
  uniformFloats[6] = passSample.fx.blur * SETTINGS.blurGain;
  uniformFloats[7] = SETTINGS.globalFx ? 1.0 : 0.0;
  uniformFloats[8] = pointer.x;
  uniformFloats[9] = pointer.y;
  uniformFloats[10] = pointer.prevX;
  uniformFloats[11] = pointer.prevY;
  uniformFloats[12] = pointer.radius;
  uniformFloats[13] = pointer.strength * SETTINGS.trailTextureMix;
  uniformFloats[14] = pointer.velocity;
  uniformFloats[15] = pointer.down ? 1.0 : 0.0;
  queue.writeBuffer(uniformBuffer, 0, uniformFloats);

  const encoder = device.createCommandEncoder({ label: "frame-encoder" });
  const pass = encoder.beginRenderPass({
    label: "fx-render-pass",
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1.0 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3, 1, 0, 0);
  pass.end();
  queue.submit([encoder.finish()]);

  requestAnimationFrame(frame);
}

function samplePass(timeSeconds) {
  const total = PASSES.reduce((sum, pass) => sum + pass.duration, 0);
  const wrapped = total > 0 ? ((timeSeconds % total) + total) % total : 0;

  let acc = 0;
  for (let i = 0; i < PASSES.length; i += 1) {
    const current = PASSES[i];
    const next = PASSES[(i + 1) % PASSES.length];
    if (wrapped <= acc + current.duration || i === PASSES.length - 1) {
      const local = wrapped - acc;
      const phase = current.duration > 0 ? local / current.duration : 0;
      const eased = smoothstep(clamp01(phase));
      return {
        label: current.label,
        fx: {
          displacement: mix(current.fx.displacement, next.fx.displacement, eased),
          chroma: mix(current.fx.chroma, next.fx.chroma, eased),
          blur: mix(current.fx.blur, next.fx.blur, eased),
          pixelate: mix(current.fx.pixelate, next.fx.pixelate, eased),
        },
      };
    }
    acc += current.duration;
  }

  return { label: PASSES[0].label, fx: PASSES[0].fx };
}

function updateHud(passSample) {
  if (passSample.label !== lastPassLabel) {
    hudPass.textContent = passSample.label;
    passLabel.textContent = passSample.label;
    lastPassLabel = passSample.label;
  }
}

function drawSourceLayerToCanvas(ctx, targetCanvas, domRoot) {
  const dpr = targetCanvas.width / Math.max(window.innerWidth, 1);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  ctx.fillStyle = "#f5f5f3";
  ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
  drawBackdrop(ctx, targetCanvas.width, targetCanvas.height);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSurfaces(ctx, domRoot);
  drawTextNodes(ctx, domRoot);
}

function updateTrailField() {
  const vx = (pointer.x - pointer.prevX) * trailCanvas.width;
  const vy = (pointer.y - pointer.prevY) * trailCanvas.height;
  const shiftX = -vx * SETTINGS.trailAdvection;
  const shiftY = -vy * SETTINGS.trailAdvection;

  trailTempCtx.setTransform(1, 0, 0, 1, 0, 0);
  trailTempCtx.globalCompositeOperation = "source-over";
  trailTempCtx.clearRect(0, 0, trailTempCanvas.width, trailTempCanvas.height);
  trailTempCtx.globalAlpha = clamp01(SETTINGS.trailFeedback);
  trailTempCtx.filter = `blur(${Math.max(0, SETTINGS.trailBlurPx)}px)`;
  trailTempCtx.drawImage(trailCanvas, shiftX, shiftY);
  trailTempCtx.filter = "none";
  trailTempCtx.globalAlpha = 1.0;

  trailCtx.setTransform(1, 0, 0, 1, 0, 0);
  trailCtx.globalCompositeOperation = "source-over";
  trailCtx.fillStyle = `rgba(0, 0, 0, ${clamp01(SETTINGS.trailDecay)})`;
  trailCtx.fillRect(0, 0, trailCanvas.width, trailCanvas.height);
  trailCtx.drawImage(trailTempCanvas, 0, 0);

  if (pointer.strength < 0.005 && !pointer.down) {
    return;
  }

  const x0 = pointer.prevX * trailCanvas.width;
  const y0 = pointer.prevY * trailCanvas.height;
  const x1 = pointer.x * trailCanvas.width;
  const y1 = pointer.y * trailCanvas.height;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const segment = Math.max(1, Math.hypot(dx, dy));

  const radiusPx = Math.max(
    5,
    trailCanvas.width * SETTINGS.trailRadius * (0.85 + pointer.velocity * SETTINGS.trailStretch),
  );

  const steps = Math.max(1, Math.ceil(segment / Math.max(1, radiusPx * SETTINGS.trailSpacing)));
  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 1 : i / steps;
    const x = x0 + dx * t;
    const y = y0 + dy * t;

    const tipBias = Math.pow(t, SETTINGS.tipBoost);
    const alpha = SETTINGS.trailOpacity * pointer.strength * (0.12 + 0.88 * tipBias);
    const r = radiusPx * (0.74 + 0.32 * tipBias);
    stampTrailSquare(x, y, r, alpha);
  }

  if (pointer.down) {
    stampTrailSquare(x1, y1, radiusPx * 1.18, SETTINGS.trailOpacity * 0.62);
  }

  if (pointer.inside && pointer.strength > 0.03) {
    trailHistory.unshift({
      x: x1,
      y: y1,
      speed: pointer.velocity,
      life: 1.0,
    });
    if (trailHistory.length > MAX_TRAIL_HISTORY) {
      trailHistory.pop();
    }
  }

  for (let i = 0; i < trailHistory.length; i += 1) {
    const item = trailHistory[i];
    const age = i / Math.max(1, trailHistory.length - 1);
    item.life *= pointer.inside ? 0.968 : 0.935;
    const alpha = SETTINGS.trailOpacity * SETTINGS.trailGhost * item.life * (1.0 - age * 0.72);
    const r = radiusPx * (0.62 + item.speed * 0.7) * (1.0 - age * 0.45);
    stampTrailSquare(item.x, item.y, r, alpha);
  }

  for (let i = trailHistory.length - 1; i >= 0; i -= 1) {
    if (trailHistory[i].life < 0.04) {
      trailHistory.splice(i, 1);
    }
  }
}

function stampTrailSquare(x, y, radius, alpha) {
  const size = Math.max(2, radius * 2);
  const x0 = x - size * 0.5;
  const y0 = y - size * 0.5;
  trailCtx.globalCompositeOperation = "lighter";
  trailCtx.fillStyle = `rgba(255,255,255,${clamp01(alpha)})`;
  trailCtx.fillRect(x0, y0, size, size);
  trailCtx.globalCompositeOperation = "source-over";
}

function drawBackdrop(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#f7f7f5");
  gradient.addColorStop(0.45, "#dfdfdc");
  gradient.addColorStop(1, "#bfc0bd");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawSurfaces(ctx, root) {
  const surfaces = root.querySelectorAll(".fx-surface");
  for (const el of surfaces) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      continue;
    }
    const grad = ctx.createLinearGradient(rect.left, rect.top, rect.right, rect.bottom);
    grad.addColorStop(0, "#1f1cff");
    grad.addColorStop(0.28, "#32ccff");
    grad.addColorStop(0.58, "#e33fd1");
    grad.addColorStop(0.78, "#ffe36a");
    grad.addColorStop(1, "#ef2d2d");
    roundRect(ctx, rect.left, rect.top, rect.width, rect.height, 8);
    ctx.fillStyle = grad;
    ctx.fill();
  }
}

function drawTextNodes(ctx, root) {
  const nodes = root.querySelectorAll(".fx-source");
  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      continue;
    }

    const style = getComputedStyle(el);
    const fontSize = style.fontSize;
    const fontWeight = style.fontWeight || "400";
    const fontStyle = style.fontStyle || "normal";
    const fontFamily = style.fontFamily || "sans-serif";
    const lineHeight = parseLineHeight(style.lineHeight, style.fontSize);
    const letterSpacing = parseFloat(style.letterSpacing) || 0;

    ctx.font = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;
    ctx.fillStyle = style.color || "#111111";
    ctx.textBaseline = "top";

    const text = (el.textContent || "").trim();
    if (!text) {
      continue;
    }

    if (el.tagName === "P") {
      drawWrappedText(ctx, text, rect.left, rect.top, rect.width, lineHeight, letterSpacing);
    } else {
      drawTextWithSpacing(ctx, text, rect.left, rect.top, letterSpacing);
    }
  }
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, letterSpacing) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureWithSpacing(ctx, candidate, letterSpacing) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) {
    lines.push(current);
  }

  for (let i = 0; i < lines.length; i += 1) {
    drawTextWithSpacing(ctx, lines[i], x, y + i * lineHeight, letterSpacing);
  }
}

function drawTextWithSpacing(ctx, text, x, y, letterSpacing) {
  if (Math.abs(letterSpacing) < 0.001) {
    ctx.fillText(text, x, y);
    return;
  }

  let cx = x;
  for (const char of text) {
    ctx.fillText(char, cx, y);
    cx += ctx.measureText(char).width + letterSpacing;
  }
}

function measureWithSpacing(ctx, text, letterSpacing) {
  if (Math.abs(letterSpacing) < 0.001) {
    return ctx.measureText(text).width;
  }
  let width = 0;
  for (const char of text) {
    width += ctx.measureText(char).width + letterSpacing;
  }
  return width;
}

function parseLineHeight(lineHeightValue, fontSizeValue) {
  if (!lineHeightValue || lineHeightValue === "normal") {
    return parseFloat(fontSizeValue || "16") * 1.2;
  }
  const parsed = parseFloat(lineHeightValue);
  return Number.isFinite(parsed) ? parsed : parseFloat(fontSizeValue || "16") * 1.2;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function showFallback(message) {
  const note = document.createElement("div");
  note.style.position = "fixed";
  note.style.left = "50%";
  note.style.top = "50%";
  note.style.transform = "translate(-50%, -50%)";
  note.style.padding = "1rem 1.2rem";
  note.style.background = "rgba(255,255,255,0.92)";
  note.style.border = "1px solid rgba(0,0,0,0.2)";
  note.style.borderRadius = "10px";
  note.style.font = "500 14px/1.35 Helvetica, Arial, sans-serif";
  note.style.color = "#111";
  note.textContent = message;
  document.body.appendChild(note);
  sourceLayer.style.opacity = "1";
  if (hudWebgpu) {
    hudWebgpu.textContent = "unavailable";
  }
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function updateWebGpuStatus() {
  if (!hudWebgpu) {
    return;
  }

  if (!window.isSecureContext) {
    hudWebgpu.textContent = "blocked (insecure context)";
    return;
  }

  if (!navigator.gpu) {
    hudWebgpu.textContent = "not supported";
    return;
  }

  hudWebgpu.textContent = "available";
}

function installPointerHandlers() {
  canvas.addEventListener("pointerenter", (event) => {
    const uv = pointerToUv(event);
    if (!uv) {
      return;
    }
    pointer.targetX = uv.x;
    pointer.targetY = uv.y;
    pointer.inside = true;
  });

  canvas.addEventListener("pointermove", (event) => {
    const uv = pointerToUv(event);
    if (!uv) {
      return;
    }
    pointer.targetX = uv.x;
    pointer.targetY = uv.y;
    pointer.inside = true;
  });

  canvas.addEventListener("pointerdown", (event) => {
    const uv = pointerToUv(event);
    if (!uv) {
      return;
    }
    pointer.targetX = uv.x;
    pointer.targetY = uv.y;
    pointer.down = true;
    pointer.inside = true;
  });

  window.addEventListener("pointerup", () => {
    pointer.down = false;
  });

  canvas.addEventListener("pointerleave", () => {
    pointer.inside = false;
    pointer.down = false;
  });
}

function pointerToUv(event) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }
  const x = clamp01((event.clientX - rect.left) / rect.width);
  const y = clamp01((event.clientY - rect.top) / rect.height);
  return { x, y };
}

function updatePointerState() {
  pointer.prevX = pointer.x;
  pointer.prevY = pointer.y;

  const follow = pointer.inside ? 0.24 : 0.08;
  pointer.x = mix(pointer.x, pointer.targetX, follow);
  pointer.y = mix(pointer.y, pointer.targetY, follow);

  const dx = pointer.x - pointer.prevX;
  const dy = pointer.y - pointer.prevY;
  const speed = Math.min(1.0, Math.hypot(dx, dy) * 38.0);
  pointer.velocity = mix(pointer.velocity, speed, 0.3);

  pointer.targetStrength = pointer.inside ? (pointer.down ? 1.0 : 0.95) : 0.0;
  pointer.strength = mix(pointer.strength, pointer.targetStrength, pointer.inside ? 0.2 : 0.08);

  const targetRadius = pointer.inside
    ? 0.12 + pointer.velocity * 0.1 + (pointer.down ? 0.04 : 0.0)
    : 0.16;
  pointer.radius = mix(pointer.radius, targetRadius, 0.16);
}

async function setupControls() {
  try {
    const { Pane } = await import("https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js");
    const pane = new Pane({ title: "FX" });

    const f1 = pane.addFolder({ title: "Post FX" });
    f1.addBinding(SETTINGS, "globalFx");
    f1.addBinding(SETTINGS, "displacementGain", { min: 0, max: 2.5, step: 0.01 });
    f1.addBinding(SETTINGS, "chromaGain", { min: 0, max: 2.5, step: 0.01 });
    f1.addBinding(SETTINGS, "blurGain", { min: 0, max: 2.0, step: 0.01 });
    f1.addBinding(SETTINGS, "pixelateGain", { min: 0, max: 2.0, step: 0.01 });

    const f2 = pane.addFolder({ title: "Trail" });
    f2.addBinding(SETTINGS, "trailDecay", { min: 0.01, max: 0.45, step: 0.005 });
    f2.addBinding(SETTINGS, "trailFeedback", { min: 0.0, max: 0.98, step: 0.01 });
    f2.addBinding(SETTINGS, "trailBlurPx", { min: 0.0, max: 8.0, step: 0.1 });
    f2.addBinding(SETTINGS, "trailAdvection", { min: 0.0, max: 2.5, step: 0.01 });
    f2.addBinding(SETTINGS, "trailOpacity", { min: 0.01, max: 0.6, step: 0.005 });
    f2.addBinding(SETTINGS, "trailRadius", { min: 0.03, max: 0.3, step: 0.005 });
    f2.addBinding(SETTINGS, "trailStretch", { min: 0.0, max: 1.2, step: 0.01 });
    f2.addBinding(SETTINGS, "trailSpacing", { min: 0.08, max: 0.9, step: 0.01 });
    f2.addBinding(SETTINGS, "tipBoost", { min: 0.2, max: 3.0, step: 0.05 });
    f2.addBinding(SETTINGS, "trailGhost", { min: 0.0, max: 1.0, step: 0.01 });
    f2.addBinding(SETTINGS, "trailTextureMix", { min: 0.0, max: 1.5, step: 0.01 });
  } catch (error) {
    console.warn("Tweakpane not loaded", error);
  }
}
