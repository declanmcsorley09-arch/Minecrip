/**
 * Steers a mob along a path from the {@link Pathfinder}: sets the mob's
 * desired velocity toward the next node, jumps up ledges, detects when it is
 * stuck and re-plans.
 */
export class PathNavigator {
  /**
   * @param {import('../Mob.js').Mob} mob
   * @param {import('./Pathfinder.js').Pathfinder} pathfinder
   */
  constructor(mob, pathfinder) {
    this.mob = mob;
    this.pathfinder = pathfinder;
    /** @type {{x:number,y:number,z:number}[]|null} */
    this.path = null;
    this.index = 0;
    this.speed = 0;
    this.target = null;
    this.stuckTimer = 0;
    this.lastDist = Infinity;
    this.repathCooldown = 0;
  }

  /** Whether a path is being followed. */
  get active() {
    return this.path !== null;
  }

  /**
   * Plans a path to a world position.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} speed blocks/second
   * @returns {boolean} true if a path was found
   */
  moveTo(x, y, z, speed) {
    const m = this.mob;
    this.speed = speed;
    this.target = { x, y, z };
    const path = this.pathfinder.findPath(
      Math.floor(m.x), Math.floor(m.y + 0.01), Math.floor(m.z),
      Math.floor(x), Math.floor(y), Math.floor(z),
      { height: Math.ceil(m.body.height), maxNodes: m.pathBudget ?? 600 },
    );
    this.path = path && path.length > 0 ? path : null;
    this.index = 0;
    this.stuckTimer = 0;
    this.lastDist = Infinity;
    return this.path !== null;
  }

  /** Stops moving. */
  stop() {
    this.path = null;
    this.mob.wishX = 0;
    this.mob.wishZ = 0;
  }

  /**
   * Follows the current path for one tick.
   * @param {number} dt
   */
  tick(dt) {
    const m = this.mob;
    if (!this.path) return;
    if (this.repathCooldown > 0) this.repathCooldown -= dt;
    const node = this.path[this.index];
    const cx = node.x + 0.5;
    const cz = node.z + 0.5;
    const dx = cx - m.x;
    const dz = cz - m.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.35 && Math.abs(node.y - m.y) < 1.2) {
      this.index++;
      this.stuckTimer = 0;
      this.lastDist = Infinity;
      if (this.index >= this.path.length) {
        this.stop();
        return;
      }
      return;
    }
    const s = this.speed;
    m.wishX = (dx / (dist || 1)) * s;
    m.wishZ = (dz / (dist || 1)) * s;
    if ((node.y > m.y + 0.5 && m.body.onGround) || (m.body.collidedHorizontally && m.body.onGround)) m.wantsJump = true;
    if (m.body.submersion > 0 && m.body.collidedHorizontally) m.wantsJump = true;

    // Stuck detection.
    if (dist < this.lastDist - 0.05) {
      this.lastDist = dist;
      this.stuckTimer = 0;
    } else {
      this.stuckTimer += dt;
      if (this.stuckTimer > 2) {
        if (this.target && this.repathCooldown <= 0) {
          this.repathCooldown = 1;
          this.moveTo(this.target.x, this.target.y, this.target.z, this.speed);
        } else {
          this.stop();
        }
      }
    }
  }
}
