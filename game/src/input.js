// Keyboard and pointer input for Sunset Bay. Held keys give movement and driving;
// one-shot presses (enter/exit a car, action, pause, missions, confirm) are queued as bit
// flags and taken once by the loop, so a press between two frames is never lost and never
// counted twice. This module only reads keys and the pointer: it knows nothing about the
// world, the rules or what any key does once the game has it.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER_EXIT = 4;
export const ACTION_USE = 8;
export const ACTION_MISSIONS = 16;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const ENTER_EXIT = new Set(['KeyE']);
const USE = new Set(['Space']);
const MISSIONS = new Set(['KeyM']);

/**
 * Read the keyboard and pointer on `target` (the game canvas). The returned object is
 * the input the world steps on: held directions as booleans, plus takeActions() for the
 * one-shot presses since the last call.
 */
export function createInput(target) {
  const held = { up: false, down: false, left: false, right: false };
  let actions = 0;

  function press(event, flag) {
    if (!event.repeat) actions |= flag;
  }

  window.addEventListener('keydown', (event) => {
    if (UP.has(event.code)) held.up = true;
    else if (DOWN.has(event.code)) held.down = true;
    else if (LEFT.has(event.code)) held.left = true;
    else if (RIGHT.has(event.code)) held.right = true;
    else if (ENTER_EXIT.has(event.code)) press(event, ACTION_ENTER_EXIT);
    else if (MISSIONS.has(event.code)) press(event, ACTION_MISSIONS);
    else if (PAUSE.has(event.code)) press(event, ACTION_PAUSE);
    else if (CONFIRM.has(event.code)) {
      // Space is both "action" and "confirm": menus take it as confirm, play takes it
      // as the use key. The loop decides by screen; the world sees it as action.
      press(event, ACTION_CONFIRM | ACTION_USE);
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (UP.has(event.code)) held.up = false;
    else if (DOWN.has(event.code)) held.down = false;
    else if (LEFT.has(event.code)) held.left = false;
    else if (RIGHT.has(event.code)) held.right = false;
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    held.up = false;
    held.down = false;
    held.left = false;
    held.right = false;
  });
  // Click / tap confirms on menus and is the "use" key in play.
  target.addEventListener('pointerdown', () => {
    actions |= ACTION_CONFIRM | ACTION_USE;
  });

  return {
    /** Held directions, as the world reads them every step. */
    held,
    /** -1 for left, 1 for right, 0 for neither or both. */
    steer() {
      return (held.right ? 1 : 0) - (held.left ? 1 : 0);
    },
    /** -1 for brake/reverse, 1 for accelerate, 0 for neither or both. */
    throttle() {
      return (held.up ? 1 : 0) - (held.down ? 1 : 0);
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
