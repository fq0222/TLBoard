import assert from 'node:assert/strict';
import {
  loadManualLazyImage,
  prepareManualLazyImages
} from '../src/utils/manual-lazy-images.js';

class FakeImage {
  constructor(src) {
    this.attributes = new Map();
    this.classList = {
      values: new Set(),
      add: (...names) => names.forEach((name) => this.classList.values.add(name)),
      contains: (name) => this.classList.values.has(name)
    };
    if (src) this.attributes.set('src', src);
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

function createRoot(images) {
  return {
    querySelectorAll(selector) {
      return selector === 'img' ? images : [];
    }
  };
}

function main() {
  const image = new FakeImage('/api/user/help/images/demo.jpg');

  const count = prepareManualLazyImages(createRoot([image]));
  assert.equal(count, 1);
  assert.equal(image.getAttribute('src'), null);
  assert.equal(image.getAttribute('data-src'), '/api/user/help/images/demo.jpg');
  assert.equal(image.getAttribute('loading'), 'lazy');
  assert.equal(image.classList.contains('manual-lazy-image'), true);

  assert.equal(loadManualLazyImage(image), true);
  assert.equal(image.getAttribute('src'), '/api/user/help/images/demo.jpg');
  assert.equal(image.getAttribute('data-src'), null);
  assert.equal(image.classList.contains('manual-lazy-image-loaded'), true);
}

main();
