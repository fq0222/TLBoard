const { Transform } = require('stream');

/**
 * 进程内全局令牌桶限速器。
 * 职责：让多个响应流共享同一个总带宽上限；不同业务可创建独立实例避免互相抢速。
 */
class GlobalThrottle {
  constructor() {
    this.bytesPerSecond = 0;
    this.availableTokens = 0;
    this.activeStreams = new Set();
    this.refillInterval = null;
  }

  /**
   * 更新总限速，单位为 bytes/s；0 表示不限速。
   *
   * @param {number} bytesPerSecond - 每秒可用字节数
   * @returns {void}
   */
  updateSpeed(bytesPerSecond) {
    if (this.bytesPerSecond !== bytesPerSecond) {
      this.bytesPerSecond = bytesPerSecond;
      this.availableTokens = bytesPerSecond;

      if (bytesPerSecond > 0 && !this.refillInterval) {
        this.startRefill();
      } else if (bytesPerSecond <= 0 && this.refillInterval) {
        this.stopRefill();
      }
    } else if (bytesPerSecond > 0 && !this.refillInterval) {
      this.availableTokens = bytesPerSecond;
      this.startRefill();
    }
  }

  /**
   * 创建挂接到当前限速器的 Transform 流。
   *
   * @returns {GlobalThrottleStream} 限速 Transform 流
   */
  createStream() {
    return new GlobalThrottleStream(this);
  }

  startRefill() {
    this.refillInterval = setInterval(() => {
      if (this.bytesPerSecond > 0) {
        this.availableTokens = Math.min(
          this.bytesPerSecond * 2,
          this.availableTokens + this.bytesPerSecond
        );
      }
    }, 1000);
  }

  stopRefill() {
    if (this.refillInterval) {
      clearInterval(this.refillInterval);
      this.refillInterval = null;
    }
  }

  async acquireTokens(bytes) {
    if (this.bytesPerSecond <= 0) {
      return;
    }

    while (bytes > 0) {
      if (this.availableTokens >= bytes) {
        this.availableTokens -= bytes;
        return;
      }

      const waitTime = Math.ceil((bytes - this.availableTokens) / this.bytesPerSecond * 1000);
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitTime, 100)));
    }
  }

  registerStream(stream) {
    this.activeStreams.add(stream);
  }

  unregisterStream(stream) {
    this.activeStreams.delete(stream);
    if (this.activeStreams.size === 0) {
      this.stopRefill();
    }
  }

  getActiveStreamCount() {
    return this.activeStreams.size;
  }
}

/**
 * 限速 Transform 流。
 * 关键分支：限速为 0 时直接透传；限速大于 0 时每个 chunk 先申请全局 token。
 */
class GlobalThrottleStream extends Transform {
  constructor(globalThrottle) {
    super();
    this.globalThrottle = globalThrottle;
    this.unregistered = false;
    this.globalThrottle.registerStream(this);
  }

  async _transform(chunk, encoding, callback) {
    if (this.globalThrottle.bytesPerSecond <= 0) {
      this.push(chunk);
      callback();
      return;
    }

    try {
      await this.globalThrottle.acquireTokens(chunk.length);
      this.push(chunk);
      callback();
    } catch (error) {
      callback(error);
    }
  }

  _flush(callback) {
    this.unregister();
    callback();
  }

  _destroy(error, callback) {
    this.unregister();
    callback(error);
  }

  unregister() {
    if (this.unregistered) {
      return;
    }

    this.unregistered = true;
    this.globalThrottle.unregisterStream(this);
  }
}

/**
 * 创建独立的进程内全局限速器。
 *
 * @returns {GlobalThrottle} 限速器实例
 */
function createGlobalThrottle() {
  return new GlobalThrottle();
}

module.exports = {
  GlobalThrottle,
  GlobalThrottleStream,
  createGlobalThrottle
};
