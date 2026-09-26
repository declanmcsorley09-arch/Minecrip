/**
 * Axis-aligned bounding box with the swept-clipping helpers used for voxel
 * collision (resolve Y, then X, then Z against every nearby block box).
 */
export class AABB {
  /**
   * @param {number} [minX=0]
   * @param {number} [minY=0]
   * @param {number} [minZ=0]
   * @param {number} [maxX=0]
   * @param {number} [maxY=0]
   * @param {number} [maxZ=0]
   */
  constructor(minX = 0, minY = 0, minZ = 0, maxX = 0, maxY = 0, maxZ = 0) {
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxY = maxY;
    this.maxZ = maxZ;
  }

  /**
   * @returns {AABB} this
   */
  set(minX, minY, minZ, maxX, maxY, maxZ) {
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.maxX = maxX;
    this.maxY = maxY;
    this.maxZ = maxZ;
    return this;
  }

  /**
   * Box of width w and height h whose bottom centre is at (x, y, z).
   * @returns {AABB} this
   */
  setFromFeet(x, y, z, w, h) {
    const r = w / 2;
    return this.set(x - r, y, z - r, x + r, y + h, z + r);
  }

  /**
   * @param {AABB} b
   * @returns {AABB} this
   */
  copy(b) {
    return this.set(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
  }

  /** @returns {AABB} */
  clone() {
    return new AABB(this.minX, this.minY, this.minZ, this.maxX, this.maxY, this.maxZ);
  }

  /**
   * Moves the box.
   * @returns {AABB} this
   */
  translate(dx, dy, dz) {
    this.minX += dx;
    this.maxX += dx;
    this.minY += dy;
    this.maxY += dy;
    this.minZ += dz;
    this.maxZ += dz;
    return this;
  }

  /**
   * Strict overlap test (touching faces do not intersect).
   * @param {AABB} b
   * @returns {boolean}
   */
  intersects(b) {
    return this.minX < b.maxX && this.maxX > b.minX && this.minY < b.maxY && this.maxY > b.minY && this.minZ < b.maxZ && this.maxZ > b.minZ;
  }

  /**
   * Clips a Y movement of `this` against obstacle `b`.
   * @param {AABB} b obstacle
   * @param {number} dy desired movement
   * @returns {number} allowed movement
   */
  clipY(b, dy) {
    if (this.maxX <= b.minX || this.minX >= b.maxX || this.maxZ <= b.minZ || this.minZ >= b.maxZ) return dy;
    if (dy > 0 && this.maxY <= b.minY) {
      const d = b.minY - this.maxY;
      if (d < dy) return d;
    } else if (dy < 0 && this.minY >= b.maxY) {
      const d = b.maxY - this.minY;
      if (d > dy) return d;
    }
    return dy;
  }

  /**
   * Clips an X movement.
   * @param {AABB} b
   * @param {number} dx
   * @returns {number}
   */
  clipX(b, dx) {
    if (this.maxY <= b.minY || this.minY >= b.maxY || this.maxZ <= b.minZ || this.minZ >= b.maxZ) return dx;
    if (dx > 0 && this.maxX <= b.minX) {
      const d = b.minX - this.maxX;
      if (d < dx) return d;
    } else if (dx < 0 && this.minX >= b.maxX) {
      const d = b.maxX - this.minX;
      if (d > dx) return d;
    }
    return dx;
  }

  /**
   * Clips a Z movement.
   * @param {AABB} b
   * @param {number} dz
   * @returns {number}
   */
  clipZ(b, dz) {
    if (this.maxX <= b.minX || this.minX >= b.maxX || this.maxY <= b.minY || this.minY >= b.maxY) return dz;
    if (dz > 0 && this.maxZ <= b.minZ) {
      const d = b.minZ - this.maxZ;
      if (d < dz) return d;
    } else if (dz < 0 && this.minZ >= b.maxZ) {
      const d = b.maxZ - this.minZ;
      if (d > dz) return d;
    }
    return dz;
  }

  /**
   * Ray intersection (slab method).
   * @param {number} ox ray origin
   * @param {number} oy
   * @param {number} oz
   * @param {number} dx ray direction (need not be normalised)
   * @param {number} dy
   * @param {number} dz
   * @returns {{t:number, face:number}|null} entry distance along the ray and hit face
   */
  raycast(ox, oy, oz, dx, dy, dz) {
    let tMin = -Infinity;
    let tMax = Infinity;
    let face = -1;
    const axes = [
      [ox, dx, this.minX, this.maxX, 1, 0],
      [oy, dy, this.minY, this.maxY, 3, 2],
      [oz, dz, this.minZ, this.maxZ, 5, 4],
    ];
    for (const [o, d, mn, mx, negFace, posFace] of axes) {
      if (Math.abs(d) < 1e-12) {
        if (o < mn || o > mx) return null;
        continue;
      }
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      let f1 = negFace;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        f1 = posFace;
      }
      if (t1 > tMin) {
        tMin = t1;
        face = f1;
      }
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return null;
    }
    if (tMax < 0) return null;
    return { t: Math.max(0, tMin), face };
  }
}
