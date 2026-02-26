/**
 * FlowCredit – WebGL Gradient Mesh Background
 * Organic noise-based fragment shader. Dark mode only.
 * No external libraries. Pure WebGL.
 */
(function () {
  'use strict';

  const VERT_SRC = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  // Simplex-like smooth noise + animated mesh
  const FRAG_SRC = `
    precision mediump float;

    uniform float u_time;
    uniform vec2  u_resolution;

    // --- Hash & noise helpers ---
    vec3 hash3(vec2 p) {
      vec3 q = vec3(
        dot(p, vec2(127.1, 311.7)),
        dot(p, vec2(269.5, 183.3)),
        dot(p, vec2(419.2,  371.9))
      );
      return fract(sin(q) * 43758.5453);
    }

    float smoothNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);

      float a = dot(hash3(i + vec2(0,0)).xy, f - vec2(0,0));
      float b = dot(hash3(i + vec2(1,0)).xy, f - vec2(1,0));
      float c = dot(hash3(i + vec2(0,1)).xy, f - vec2(0,1));
      float d = dot(hash3(i + vec2(1,1)).xy, f - vec2(1,1));

      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 0.5 + 0.5;
    }

    float fbm(vec2 p) {
      float val = 0.0;
      float amp = 0.5;
      float freq = 1.0;
      for (int i = 0; i < 5; i++) {
        val += amp * smoothNoise(p * freq);
        amp  *= 0.5;
        freq *= 2.1;
      }
      return val;
    }

    void main() {
      // Normalized UV (0..1)
      vec2 uv = gl_FragCoord.xy / u_resolution;

      // Slow cinematic time (20-40s cycle)
      float t = u_time * 0.028;

      // Warped domain with two layers of fbm
      vec2 q = vec2(
        fbm(uv + vec2(0.0,  0.0) + t * 0.4),
        fbm(uv + vec2(5.2,  1.3) + t * 0.3)
      );

      vec2 r = vec2(
        fbm(uv + 4.0 * q + vec2(1.7, 9.2) + t * 0.25),
        fbm(uv + 4.0 * q + vec2(8.3, 2.8) + t * 0.20)
      );

      float f = fbm(uv + 4.0 * r + t * 0.15);

      // Color palette – deep indigo / blue / violet (no neon)
      // Base: very deep navy  (#070C18)
      // Mid:  indigo          (#1a1060)
      // High: blue-violet     (#312B6D)
      vec3 col = mix(
        vec3(0.027, 0.047, 0.094),   // deep navy
        vec3(0.102, 0.063, 0.376),   // indigo
        clamp(f * f * 4.0, 0.0, 1.0)
      );

      col = mix(
        col,
        vec3(0.188, 0.169, 0.431),   // blue-violet
        clamp(length(q), 0.0, 1.0)
      );

      col = mix(
        col,
        vec3(0.086, 0.114, 0.357),   // midnight blue
        clamp(length(r.x), 0.0, 1.0)
      );

      // Subtle vignette
      float vig = uv.x * (1.0 - uv.x) * uv.y * (1.0 - uv.y) * 14.0;
      vig = clamp(vig, 0.0, 1.0);
      col *= mix(0.5, 1.0, vig);

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  let canvas, gl, program, posBuffer;
  let uTime, uRes;
  let rafId = null;
  let startTime = performance.now();
  let active = false;

  function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[WebGL BG] Shader error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function init() {
    // Create canvas
    canvas = document.createElement('canvas');
    canvas.id = 'webglBg';
    canvas.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:100%',
      'height:100%',
      'z-index:-2',
      'pointer-events:none',
      'display:block',
      'opacity:0',
      'transition:opacity 0.8s ease'
    ].join(';');

    document.body.prepend(canvas);

    gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) {
      console.warn('[WebGL BG] WebGL not supported. Falling back.');
      canvas.remove();
      return false;
    }

    const vert = compileShader(gl.VERTEX_SHADER, VERT_SRC);
    const frag = compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vert || !frag) return false;

    program = gl.createProgram();
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[WebGL BG] Link error:', gl.getProgramInfoLog(program));
      return false;
    }

    gl.useProgram(program);

    // Full-screen quad
    const verts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    const loc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    uTime = gl.getUniformLocation(program, 'u_time');
    uRes = gl.getUniformLocation(program, 'u_resolution');

    resize();
    return true;
  }

  function resize() {
    if (!canvas || !gl) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Use 0.8x pixel ratio for performance on mid-range laptops
    const pr = Math.min(window.devicePixelRatio || 1, 1.5) * 0.8;
    canvas.width = Math.round(w * pr);
    canvas.height = Math.round(h * pr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function render(now) {
    if (!active || !gl) return;
    rafId = requestAnimationFrame(render);

    const t = (now - startTime) * 0.001; // seconds
    gl.uniform1f(uTime, t);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function startLoop() {
    if (active) return;
    active = true;
    startTime = performance.now();
    rafId = requestAnimationFrame(render);
  }

  function stopLoop() {
    active = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (canvas) canvas.style.opacity = '0';
  }

  function isDarkMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function isBgDisabled() {
    return document.documentElement.classList.contains('bg-disabled');
  }

  function syncState() {
    if (!canvas) return;
    if (isDarkMode() && !isBgDisabled()) {
      canvas.style.opacity = '1';
      startLoop();
    } else {
      stopLoop();
    }
  }

  // Boot
  document.addEventListener('DOMContentLoaded', () => {
    if (!init()) return;

    // Watch theme changes
    const observer = new MutationObserver(syncState);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

    // Window resize
    window.addEventListener('resize', () => {
      resize();
    }, { passive: true });

    syncState();
  });
})();
