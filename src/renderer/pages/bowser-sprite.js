/* <bowser-sprite> — the animated Bowser mascot for loading states, empty
   states, and playful brand moments.

   Renders the user-supplied pixel-art doberman (bowser-sprite-sheet.png,
   16 frames extracted from the source animation): the dog stands, walks a
   few steps, sits, looks around, and wags — then keeps idling seated.
   Artwork palette is fixed (black + rust); it is NOT recolorable.

   Usage:
     <script src="bowser-sprite.js"></script>
     <bowser-sprite scale="5"></bowser-sprite>
     <bowser-sprite scale="3" fps="4" still></bowser-sprite>

   Attributes:
     scale — sizing: rendered height = 21×scale px (default 4), matching
             the footprint of the earlier grid sprite
     fps   — animation speed (default 4)
     still — render the first frame only, no animation
   (color / accent attributes from the old grid sprite are ignored — the
   artwork has a fixed palette.)
   Honors prefers-reduced-motion (renders the base frame, static). */

(() => {
  const FRAMES = 16;
  const SHEET_URL = new URL("bowser-sprite-sheet.png?v=4", document.currentScript.src).href;
  // Play the walk-and-sit sequence once, then idle on the seated frames.
  const INTRO = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const IDLE_LOOP = [12, 13, 12, 12, 14, 15, 14, 12];

  let sheetPromise = null;
  function loadSheet() {
    if (!sheetPromise) {
      sheetPromise = new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = SHEET_URL;
      });
    }
    return sheetPromise;
  }

  class BowserSprite extends HTMLElement {
    connectedCallback() {
      if (this._timer) clearInterval(this._timer);
      this.querySelectorAll("canvas").forEach((c) => c.remove());
      const scale = Math.max(1, parseFloat(this.getAttribute("scale") || "4"));
      const fps = Math.max(1, parseFloat(this.getAttribute("fps") || "4"));
      const canvas = document.createElement("canvas");
      canvas.style.display = "block";
      canvas.style.imageRendering = "pixelated";
      this.appendChild(canvas);
      const ctx = canvas.getContext("2d");

      loadSheet().then((sheet) => {
        if (!canvas.isConnected) return;
        const fw = sheet.width / FRAMES, fh = sheet.height;
        const h = Math.round(21 * scale);
        const w = Math.round(h * (fw / fh));
        canvas.width = w; canvas.height = h;
        ctx.imageSmoothingEnabled = false;

        const draw = (f) => {
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(sheet, f * fw, 0, fw, fh, 0, 0, w, h);
        };

        draw(0);
        const still = this.hasAttribute("still") ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (still) return;

        let i = 0;
        this._timer = setInterval(() => {
          i++;
          const f = i < INTRO.length ? INTRO[i]
            : IDLE_LOOP[(i - INTRO.length) % IDLE_LOOP.length];
          draw(f);
        }, 1000 / fps);
      }).catch(() => { /* sheet missing — leave empty */ });
    }
    disconnectedCallback() {
      if (this._timer) clearInterval(this._timer);
    }
  }

  if (!customElements.get("bowser-sprite")) {
    customElements.define("bowser-sprite", BowserSprite);
  }
})();
