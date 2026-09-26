/**
 * Minimal DOM construction helpers for the UI layer.
 * @module ui/dom
 */

/**
 * Creates an element.
 * @param {string} tag tag name with optional `.class` suffixes (e.g. `div.panel.big`)
 * @param {object} [props] attributes / properties / event handlers (`onClick`...)
 * @param {...(Node|string|null|undefined|false|Array)} children
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = [el.className, value].filter(Boolean).join(' ');
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key in el && typeof value !== 'string') {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

/**
 * Appends children (flattening arrays, skipping empty values).
 * @param {HTMLElement} el
 * @param {Array} children
 */
function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

/**
 * Standard menu button.
 * @param {string} label
 * @param {() => void} onClick
 * @param {object} [props]
 * @returns {HTMLButtonElement}
 */
export function button(label, onClick, props = {}) {
  return /** @type {HTMLButtonElement} */ (h(`button.btn${props.wide ? '.wide' : ''}${props.danger ? '.danger' : ''}${props.small ? '.small' : ''}`, {
    type: 'button',
    onClick: (e) => {
      e.stopPropagation();
      onClick(e);
    },
    disabled: props.disabled,
    title: props.title,
  }, label));
}

/**
 * Removes every child of an element.
 * @param {HTMLElement} el
 */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * Formats a timestamp as a short local date/time.
 * @param {number} ts
 * @returns {string}
 */
export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
