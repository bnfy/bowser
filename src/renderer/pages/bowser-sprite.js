/* <bowser-sprite> — an animated pixel-sprite rendition of the Bowser dog,
   for loading states, empty states, and playful brand moments.
   Original 24×21 pixel art of a standing doberman in profile — tall
   cropped ears, wedge muzzle, deep chest, docked tail — with tan markings
   on muzzle, chest, and paws (accent attribute).
   A companion to the real logo, never a replacement.

   Usage:
     <script src="assets/bowser-sprite.js"></script>
     <bowser-sprite scale="5"></bowser-sprite>
     <bowser-sprite scale="3" color="#f4f4f1" accent="#a8c8b0" fps="6"></bowser-sprite>

   Attributes:
     scale — px per pixel-cell (default 4)
     color  — body color (default: inherited CSS color)
     accent — marking color: muzzle, chest, paws (default #a8c8b0)
     fps   — animation speed (default 6)
   Honors prefers-reduced-motion (renders the base frame, static).

   Vendored from the Bowser Design System with two local changes:
   - `accent` falls back to the `--sprite-accent` CSS variable before the
     built-in default, so themes can drive both colors from the stylesheet.
   - The reduced-motion static frame repaints on prefers-color-scheme
     changes (colors are read from CSS at draw time and would go stale). */

(() => {
  const W = 24, H = 21;

  // '#' body · 'e' eye (punched out) · '.' empty
  // Standing doberman in profile (facing left) — tall cropped ears, wedge
  // muzzle, deep chest, straight back, docked tail. Two colors like classic
  // sprite art: '#' = body, 't' = tan markings (muzzle, chest, paws),
  // 'e' = eye (punched out).
  const IDLE = [
    "......#.................",
    "......##................",
    "......##.#..............",
    "....######..............",
    "..tt#e####..............",
    ".ttt######..............",
    "..tt#####...............",
    "....#####...............",
    ".....####...............",
    ".....#####............#.",
    ".....##################.",
    ".....#################..",
    ".....t################..",
    ".....t###############...",
    ".....####......#####....",
    ".....###........####....",
    ".....###........####....",
    ".....###.........###....",
    ".....###.........###....",
    ".....ttt.........ttt....",
    "........................",
  ];

  const BLINK = IDLE.slice();
  BLINK[4] = "..tt######..............";

  const FLICK = IDLE.slice();       // ear tips flick
  FLICK[0] = ".......#................";
  FLICK[2] = "......##..#.............";

  const WAG = IDLE.slice();         // docked tail wags up
  WAG[8] = ".....####..............#";
  WAG[9] = ".....#####..............";

  // Gentle idle loop: mostly still, occasional blink, flick, wag.
  const SEQUENCE = [IDLE, IDLE, IDLE, IDLE, BLINK, IDLE, IDLE, FLICK, WAG, IDLE, WAG, IDLE];

  class BowserSprite extends HTMLElement {
    connectedCallback() {
      // Guard against re-connection (React StrictMode, DOM reorder): drop
      // any canvas from a previous connect before appending a fresh one.
      if (this._timer) clearInterval(this._timer);
      this.querySelectorAll("canvas").forEach((c) => c.remove());
      const scale = Math.max(1, parseInt(this.getAttribute("scale") || "4", 10));
      const fps = Math.max(1, parseFloat(this.getAttribute("fps") || "6"));
      const canvas = document.createElement("canvas");
      canvas.width = W * scale;
      canvas.height = H * scale;
      canvas.style.display = "block";
      canvas.style.imageRendering = "pixelated";
      this.appendChild(canvas);
      const ctx = canvas.getContext("2d");

      const draw = (frame) => {
        const style = getComputedStyle(this);
        const color = this.getAttribute("color") || style.color;
        const tan = this.getAttribute("accent") || style.getPropertyValue("--sprite-accent").trim() || "#a8c8b0";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const ch = frame[y][x];
            if (ch === "#") { ctx.fillStyle = color; ctx.fillRect(x * scale, y * scale, scale, scale); }
            else if (ch === "t") { ctx.fillStyle = tan; ctx.fillRect(x * scale, y * scale, scale, scale); }
          }
        }
      };

      draw(SEQUENCE[0]);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        // No animation loop to pick up new CSS colors — repaint the static
        // frame when the scheme flips.
        this._scheme = window.matchMedia("(prefers-color-scheme: dark)");
        this._onScheme = () => draw(SEQUENCE[0]);
        this._scheme.addEventListener("change", this._onScheme);
        return;
      }

      let i = 0;
      this._timer = setInterval(() => {
        i = (i + 1) % SEQUENCE.length;
        draw(SEQUENCE[i]);
      }, 1000 / fps);
    }
    disconnectedCallback() {
      if (this._timer) clearInterval(this._timer);
      if (this._scheme) this._scheme.removeEventListener("change", this._onScheme);
    }
  }

  if (!customElements.get("bowser-sprite")) {
    customElements.define("bowser-sprite", BowserSprite);
  }
})();
