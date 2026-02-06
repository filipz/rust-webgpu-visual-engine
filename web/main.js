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

const SHADER = /* wgsl */ `
struct VertexOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
}

struct FxUniform {
  resolution : vec2<f32>,
  time : f32,
  displacement : f32,
  chroma : f32,
  pixelate : f32,
  blur_amount : f32,
  mix_strength : f32,
  _pad : f32,
}

@group(0) @binding(0) var source_tex : texture_2d<f32>;
@group(0) @binding(1) var source_sampler : sampler;
@group(0) @binding(2) var<uniform> fx : FxUniform;

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
  let px = vec2<f32>(1.0 / fx.resolution.x, 1.0 / fx.resolution.y);
  let pixel_size = max(1.0, mix(1.0, 22.0, clamp(fx.pixelate, 0.0, 1.0)));
  let snapped_uv = floor(in.uv * fx.resolution / pixel_size) * pixel_size / fx.resolution;

  let wave_a = sin((snapped_uv.y + fx.time * 0.34) * 29.0);
  let wave_b = cos((snapped_uv.x - fx.time * 0.21) * 33.0);
  let wave_c = sin((snapped_uv.x + snapped_uv.y + fx.time * 0.49) * 21.0);
  let offset = vec2<f32>(wave_a + wave_b, wave_c) * (0.0032 * fx.displacement);
  let base_uv = snapped_uv + offset;

  let chroma_shift = vec2<f32>(0.0055 * fx.chroma, 0.0);
  var color = vec3<f32>(
    sample_safe(base_uv + chroma_shift).r,
    sample_safe(base_uv).g,
    sample_safe(base_uv - chroma_shift).b
  );

  let blur_px = px * (1.0 + fx.blur_amount * 9.0);
  let blurred =
    sample_safe(base_uv + vec2<f32>( blur_px.x, 0.0)) +
    sample_safe(base_uv - vec2<f32>( blur_px.x, 0.0)) +
    sample_safe(base_uv + vec2<f32>(0.0,  blur_px.y)) +
    sample_safe(base_uv - vec2<f32>(0.0,  blur_px.y)) +
    sample_safe(base_uv);
  color = mix(color, blurred / 5.0, clamp(fx.blur_amount, 0.0, 1.0));

  let contrast = 1.06 + fx.displacement * 0.08;
  let graded = (color - 0.5) * contrast + 0.5;
  let final_color = mix(sample_safe(in.uv), graded, clamp(fx.mix_strength, 0.0, 1.0));

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

let sourceTexture = null;
let bindGroup = null;
let presentationFormat = null;
let pipeline = null;
let uniformBuffer = null;
let device = null;
let queue = null;
let context = null;
let lastPassLabel = "";

const uniformFloats = new Float32Array(8);
const uniformBytes = uniformFloats.byteLength;

init().catch((error) => {
  console.error(error);
  showFallback(`WebGPU init failed: ${String(error)}`);
});

async function init() {
  updateWebGpuStatus();

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

  sourceTexture = device.createTexture({
    label: "source-dom-texture",
    size: [width, height, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const sampler = device.createSampler({
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
    ],
  });
}

function frame(nowMs) {
  const now = nowMs * 0.001;
  const passSample = samplePass(now);
  updateHud(passSample);
  drawSourceLayerToCanvas(sourceCtx, sourceCanvas, sourceLayer);
  queue.copyExternalImageToTexture(
    { source: sourceCanvas },
    { texture: sourceTexture },
    [sourceCanvas.width, sourceCanvas.height],
  );

  uniformFloats[0] = canvas.width;
  uniformFloats[1] = canvas.height;
  uniformFloats[2] = now;
  uniformFloats[3] = passSample.fx.displacement;
  uniformFloats[4] = passSample.fx.chroma;
  uniformFloats[5] = passSample.fx.pixelate;
  uniformFloats[6] = passSample.fx.blur;
  uniformFloats[7] = 1.0;
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
