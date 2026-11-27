/** Most colours a palette clamp takes: the pixel finish cuts effects to 5–6, and the shader loop is unrolled to this. */
export const MAX_PALETTE = 16;

/** Parses `#rgb` / `#rrggbb` colours into the flat 0–1 RGB array the finish shader reads. */
export function parsePalette(colors: readonly string[]): Float32Array {
  if (colors.length > MAX_PALETTE) throw new RangeError(`A vfx palette takes at most ${MAX_PALETTE} colours`);
  const out = new Float32Array(colors.length * 3);
  colors.forEach((color, i) => {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
    if (!hex) throw new RangeError(`Not a #rgb or #rrggbb colour: ${color}`);
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = parseInt(full.slice(k * 2, k * 2 + 2), 16) / 255;
  });
  return out;
}

const VERTEX = `attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/*
 * Effekseer's additive particles write colour without alpha, so coverage is the brightest of alpha and colour. Faint
 * pixels under the cutoff are dropped. With a palette each kept pixel becomes its nearest palette colour, opaque, like
 * gm-sprite-forge's pixel_finish; without one the effect keeps its soft edges.
 */
const FRAGMENT = `precision mediump float;
uniform sampler2D u_src;
uniform vec3 u_palette[${MAX_PALETTE}];
uniform int u_count;
uniform float u_cutoff;
varying vec2 v_uv;
void main() {
  vec4 c = texture2D(u_src, v_uv);
  float cover = max(c.a, max(c.r, max(c.g, c.b)));
  if (cover <= u_cutoff) {
    gl_FragColor = vec4(0.0);
    return;
  }
  if (u_count == 0) {
    gl_FragColor = vec4(min(c.rgb, vec3(cover)), cover);
    return;
  }
  vec3 color = c.rgb / cover;
  vec3 best = u_palette[0];
  float bestDistance = 1e9;
  for (int i = 0; i < ${MAX_PALETTE}; i++) {
    if (i >= u_count) break;
    vec3 d = color - u_palette[i];
    float distance = dot(d, d);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = u_palette[i];
    }
  }
  gl_FragColor = vec4(best, 1.0);
}`;

type GL = WebGLRenderingContext | WebGL2RenderingContext;

function compile(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(`vfx finish shader: ${gl.getShaderInfoLog(shader)}`);
  return shader;
}

/** The offscreen target Effekseer draws into and the pass that copies it to the canvas through the finish. */
export interface FinishPass {
  /** Binds and clears the offscreen target at the canvas size; Effekseer draws next. */
  begin(width: number, height: number): void;
  /** Draws the offscreen target to the canvas through the finish. */
  end(): void;
  dispose(): void;
}

export function createFinishPass(gl: GL, palette: Float32Array, cutoff: number): FinishPass {
  const program = gl.createProgram()!;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(`vfx finish program: ${gl.getProgramInfoLog(program)}`);
  const position = gl.getAttribLocation(program, 'a_pos');
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'u_src'), 0);
  if (palette.length) gl.uniform3fv(gl.getUniformLocation(program, 'u_palette'), palette);
  gl.uniform1i(gl.getUniformLocation(program, 'u_count'), palette.length / 3);
  gl.uniform1f(gl.getUniformLocation(program, 'u_cutoff'), cutoff);

  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  let size = [0, 0];

  return {
    begin(width, height) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      if (size[0] !== width || size[1] !== height) {
        size = [width, height];
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        for (const param of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
          gl.texParameteri(gl.TEXTURE_2D, param, gl.NEAREST);
        for (const param of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
          gl.texParameteri(gl.TEXTURE_2D, param, gl.CLAMP_TO_EDGE);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      }
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    end() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, size[0], size[1]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (const cap of [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST]) gl.disable(cap);
      gl.colorMask(true, true, true, true);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      gl.deleteBuffer(quad);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}
