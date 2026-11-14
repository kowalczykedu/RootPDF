/**
 * Procedural Botanical Root System — Rosé Pine Edition (Spec 05)
 * Generates a unique, seam-free organic root network emerging flush from a
 * random viewport corner vertex on each session load:
 * - Continuous closed Bezier ribbons (zero overlapping joint circles/blobs)
 * - Wide lateral branching sweeping across the entire viewport from base to mid
 * - Needle-sharp distal & live growing tips tapering smoothly to r = 0
 * - 4.0s cinematic multi-wave growth with incremental offscreen baking
 * - Single unified GPU CSS opacity pulse across all roots after settling (0% JS CPU)
 */

type CornerId = "top-left" | "top-right" | "bottom-left" | "bottom-right";

interface BranchNode {
  x: number;
  y: number;
  r: number;
  angle: number;
  normDist: number;
}

interface RootBranch {
  id: number;
  generation: number;
  isLeader: boolean;
  isCapillary: boolean;
  isBridge: boolean;
  startPhase: number;
  endPhase: number;
  nodes: BranchNode[];
  baked: boolean;
}

interface BranchSeedSpec {
  x: number;
  y: number;
  angle: number;
  targetAngle: number;
  angularVel: number;
  thickness: number;
  maxParentRadius: number;
  generation: number;
  splitCount: number;
  splitWait: number;
  trunkId: number;
  seed: number;
  isLeader: boolean;
  isCapillary: boolean;
  maxSteps: number;
  startPhase: number;
  endPhase: number;
}

interface TrunkAnchor {
  x: number;
  y: number;
  step: number;
  trunkId: number;
  thickness: number;
  phase: number;
}

interface OriginMetrics {
  width: number;
  height: number;
  originX: number;
  originY: number;
  targetX: number;
  targetY: number;
  diagAngle: number;
  maxDiagonal: number;
}

interface ActivePoint {
  x: number;
  y: number;
  r: number;
  normDist: number;
}

const CORNERS: readonly CornerId[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right"
];

const RGB_ROSE: [number, number, number] = [235, 188, 186]; // #ebbcba
const RGB_IRIS: [number, number, number] = [196, 167, 231]; // #c4a7e7
const RGB_FOAM: [number, number, number] = [156, 207, 216]; // #9ccfd8
const RGB_PINE: [number, number, number] = [49, 116, 143];  // #31748f

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function interpolateRootColor(normalizedDist: number): string {
  const t = clamp(normalizedDist, 0, 1);
  let c1: [number, number, number];
  let c2: [number, number, number];
  let localT: number;

  if (t < 0.42) {
    c1 = RGB_ROSE;
    c2 = RGB_IRIS;
    localT = t / 0.42;
  } else if (t < 0.78) {
    c1 = RGB_IRIS;
    c2 = RGB_FOAM;
    localT = (t - 0.42) / 0.36;
  } else {
    c1 = RGB_FOAM;
    c2 = RGB_PINE;
    localT = (t - 0.78) / 0.22;
  }

  const r = Math.round(lerp(c1[0], c2[0], localT));
  const g = Math.round(lerp(c1[1], c2[1], localT));
  const b = Math.round(lerp(c1[2], c2[2], localT));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Mulberry32 PRNG seeded once per session so every load chooses a fresh
 * corner and organic geometry while remaining stable on viewport resize.
 */
function createRng(initialSeed: number): () => number {
  let s = initialSeed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Guarantees a botanical needle tip (radius -> 0) over the distal end of any
 * non-bridge branch so no branch ever terminates with a blunt/square cut.
 */
function applyNeedleTaper(nodes: BranchNode[], isBridge: boolean): void {
  if (isBridge || nodes.length < 2) return;

  if (nodes.length < 4) {
    const last = nodes.length - 1;
    for (let i = 1; i <= last; i++) {
      const t = i / last;
      nodes[i].r *= Math.pow(1 - t, 1.35);
    }
    nodes[last].r = 0;
    return;
  }

  const taperCount = Math.min(
    nodes.length - 1,
    Math.max(4, Math.min(18, Math.floor(nodes.length * 0.28)))
  );
  const startIdx = nodes.length - 1 - taperCount;

  for (let k = 0; k <= taperCount; k++) {
    const idx = startIdx + k;
    const t = k / taperCount;
    nodes[idx].r *= Math.pow(1 - t, 1.45);
  }
  nodes[nodes.length - 1].r = 0;
}

/**
 * Builds a sinuous anastomosis bridge fusing two proximal trunks.
 */
function buildAnastomosisBridge(
  branchId: number,
  rng: () => number,
  anchorA: TrunkAnchor,
  anchorB: TrunkAnchor,
  originX: number,
  originY: number,
  maxDiagonal: number
): RootBranch {
  const dist = Math.hypot(anchorB.x - anchorA.x, anchorB.y - anchorA.y);
  const stepCount = Math.max(5, Math.min(9, Math.round(dist / 12)));
  const baseAngle = Math.atan2(anchorB.y - anchorA.y, anchorB.x - anchorA.x);
  const perpX = -Math.sin(baseAngle);
  const perpY = Math.cos(baseAngle);
  const archSign = rng() < 0.5 ? 1 : -1;
  const archAmp = dist * (0.12 + rng() * 0.14) * archSign;

  const bridgeThickness = Math.min(
    8.4,
    Math.max(
      3.5,
      Math.min(anchorA.thickness, anchorB.thickness) * (0.4 + rng() * 0.14)
    )
  );
  const halfBase = bridgeThickness * 0.5;
  const maxEndA = anchorA.thickness * 0.38;
  const maxEndB = anchorB.thickness * 0.38;

  const nodes: BranchNode[] = [];
  for (let i = 0; i <= stepCount; i++) {
    const t = i / stepCount;
    const archOffset = Math.sin(t * Math.PI) * archAmp;
    const x = lerp(anchorA.x, anchorB.x, t) + perpX * archOffset;
    const y = lerp(anchorA.y, anchorB.y, t) + perpY * archOffset;

    const waist = 1 - 0.26 * Math.sin(t * Math.PI);
    let r = halfBase * waist;
    if (i === 0) r = Math.min(r * 1.12, maxEndA);
    if (i === stepCount) r = Math.min(r * 1.12, maxEndB);

    const d = Math.hypot(x - originX, y - originY);
    const angle =
      i === 0
        ? baseAngle
        : Math.atan2(y - nodes[i - 1].y, x - nodes[i - 1].x);

    nodes.push({
      x,
      y,
      r,
      angle,
      normDist: d / maxDiagonal
    });
  }

  const startPhase = clamp(
    Math.max(anchorA.phase, anchorB.phase),
    0.12,
    0.72
  );
  const endPhase = clamp(startPhase + 0.15 + rng() * 0.1, startPhase + 0.08, 0.84);

  return {
    id: branchId,
    generation: 1,
    isLeader: false,
    isCapillary: false,
    isBridge: true,
    startPhase,
    endPhase,
    nodes,
    baked: false
  };
}

function buildRootNetwork(
  metrics: OriginMetrics,
  sessionSeed: number
): RootBranch[] {
  const { width, height, originX, originY, diagAngle, maxDiagonal } = metrics;

  const rng = createRng(sessionSeed);
  const isCompact = Math.min(width, height) < 680;
  const maxTotalNodes = isCompact ? 4200 : 7600;
  const viewportScale = Math.max(0.75, maxDiagonal / 1350);
  const trunkScale = Math.min(1.26, Math.pow(viewportScale, 0.35));

  const branches: RootBranch[] = [];
  const pendingSpecs: BranchSeedSpec[] = [];
  const trunkAnchors: TrunkAnchor[] = [];

  let nextBranchId = 1;
  let totalNodes = 0;
  let bridgesCreated = 0;
  const maxBridges = isCompact ? 12 : 18;

  // 10 primary trunks fanning widely (-0.68..+0.68 rad) across the full corner quadrant
  const trunkProfiles = [
    { angleOffset: -0.68, thickness: 15.0, splitWait: 4, maxSteps: isCompact ? 88 : 118 },
    { angleOffset: -0.52, thickness: 18.2, splitWait: 4, maxSteps: isCompact ? 96 : 126 },
    { angleOffset: -0.36, thickness: 20.4, splitWait: 5, maxSteps: isCompact ? 102 : 134 },
    { angleOffset: -0.2, thickness: 22.0, splitWait: 5, maxSteps: isCompact ? 108 : 142 },
    { angleOffset: -0.06, thickness: 23.2, splitWait: 6, maxSteps: isCompact ? 112 : 148 },
    { angleOffset: 0.07, thickness: 22.8, splitWait: 6, maxSteps: isCompact ? 112 : 148 },
    { angleOffset: 0.21, thickness: 21.4, splitWait: 5, maxSteps: isCompact ? 108 : 142 },
    { angleOffset: 0.37, thickness: 19.6, splitWait: 5, maxSteps: isCompact ? 102 : 134 },
    { angleOffset: 0.53, thickness: 17.8, splitWait: 4, maxSteps: isCompact ? 96 : 126 },
    { angleOffset: 0.68, thickness: 14.8, splitWait: 4, maxSteps: isCompact ? 88 : 118 }
  ];

  trunkProfiles.forEach((profile, idx) => {
    const jitter = (rng() - 0.5) * 0.05;
    const startAngle = diagAngle + profile.angleOffset + jitter;
    const startThickness =
      profile.thickness * trunkScale * (0.94 + rng() * 0.14);

    // Anchor seamlessly right inside the screen corner vertex along each ray
    pendingSpecs.push({
      x: originX,
      y: originY,
      angle: startAngle,
      targetAngle: startAngle + (rng() - 0.5) * 0.06,
      angularVel: (rng() - 0.5) * 0.045,
      thickness: startThickness,
      maxParentRadius: 32,
      generation: 0,
      splitCount: 0,
      splitWait: profile.splitWait,
      trunkId: idx,
      seed: rng() * 200,
      isLeader: true,
      isCapillary: false,
      maxSteps: profile.maxSteps,
      startPhase: idx * 0.011,
      endPhase: 0.49 + rng() * 0.08
    });
  });

  const outPad = 38;
  const edgePadX = Math.max(24, width * 0.035);
  const edgePadY = Math.max(24, height * 0.035);

  while (pendingSpecs.length > 0 && totalNodes < maxTotalNodes) {
    const spec = pendingSpecs.shift()!;

    if (!spec.isLeader && totalNodes >= maxTotalNodes - 420) {
      continue;
    }

    const nodes: BranchNode[] = [];
    const deferredForks: Array<{
      nodeIndex: number;
      angle: number;
      targetAngle: number;
      angularVel: number;
      thickness: number;
      maxParentRadius: number;
      generation: number;
      splitCount: number;
      splitWait: number;
      trunkId: number;
      seed: number;
      isLeader: boolean;
      isCapillary: boolean;
      maxSteps: number;
    }> = [];

    let x = spec.x;
    let y = spec.y;
    let angle = spec.angle;
    let targetAngle = spec.targetAngle;
    let angularVel = spec.angularVel;
    let thickness = spec.thickness;
    let stepsSinceSplit = 0;
    let nextSplitAt = spec.splitWait + Math.floor(rng() * 3);

    const startRadius = Math.min(spec.maxParentRadius, thickness * 0.5);
    const startDist = Math.hypot(x - originX, y - originY);

    nodes.push({
      x,
      y,
      r: startRadius,
      angle,
      normDist: startDist / maxDiagonal
    });

    for (let step = 1; step <= spec.maxSteps; step++) {
      if (totalNodes + nodes.length >= maxTotalNodes && !spec.isLeader) {
        break;
      }

      const curDist = Math.hypot(x - originX, y - originY);
      const curNormDist = curDist / maxDiagonal;

      // Gently deflect only if a branch actively aims outside the screen while
      // in early/mid travel — letting side wings flourish across both flanks
      if (curNormDist < 0.76) {
        let bounceX = Math.cos(targetAngle);
        let bounceY = Math.sin(targetAngle);
        let bounced = false;

        if (x < edgePadX && bounceX < 0) {
          bounceX = Math.abs(bounceX) * 0.72;
          bounced = true;
        } else if (x > width - edgePadX && bounceX > 0) {
          bounceX = -Math.abs(bounceX) * 0.72;
          bounced = true;
        }

        if (y < edgePadY && bounceY < 0) {
          bounceY = Math.abs(bounceY) * 0.72;
          bounced = true;
        } else if (y > height - edgePadY && bounceY > 0) {
          bounceY = -Math.abs(bounceY) * 0.72;
          bounced = true;
        }

        if (bounced) {
          targetAngle = Math.atan2(bounceY, bounceX);
        }
      }

      const thicknessNorm = Math.min(1, thickness / (18 * trunkScale));
      const baseStepLen = spec.isCapillary
        ? lerp(5.0, 10.5, Math.min(1, thickness / 2.2)) *
          Math.pow(viewportScale, 0.65)
        : lerp(9.5, 20.5, Math.pow(thicknessNorm, 0.55)) * viewportScale;
      const stepLength = baseStepLen * (0.9 + rng() * 0.2);

      // Smooth organic harmonic curve without sharp polygonal breaks
      const sCurveWave =
        Math.sin(step * 0.22 + spec.seed) * 0.064 +
        Math.cos(step * 0.11 - spec.seed * 0.6) * 0.046;
      const subtleTurn = rng() < 0.14 ? (rng() - 0.5) * 0.13 : 0;
      const pullStrength = spec.isLeader
        ? 0.095
        : spec.isCapillary
          ? 0.035
          : 0.075;
      const anglePull = (targetAngle - angle) * pullStrength;

      angularVel =
        angularVel * 0.78 +
        (rng() - 0.5) * (spec.isCapillary ? 0.11 : 0.072) +
        sCurveWave * 0.45 +
        subtleTurn +
        anglePull;

      const maxTurn = spec.isCapillary ? 0.28 : spec.isLeader ? 0.19 : 0.24;
      angularVel = clamp(angularVel, -maxTurn, maxTurn);
      angle += angularVel;

      x += Math.cos(angle) * stepLength;
      y += Math.sin(angle) * stepLength;

      const dist = Math.hypot(x - originX, y - originY);
      const normDist = dist / maxDiagonal;

      const distalTaper =
        normDist > 0.78
          ? lerp(1.0, 0.88, Math.min(1, (normDist - 0.78) / 0.2))
          : 1.0;

      // Preserve robust body from start through mid-field before distal taper
      const baseDecay =
        (spec.isCapillary
          ? 0.91 + rng() * 0.025
          : spec.isLeader
            ? spec.generation <= 1
              ? 0.989
              : 0.982
            : spec.generation <= 1
              ? 0.981
              : spec.generation === 2
                ? 0.971
                : 0.956) * distalTaper;

      thickness *= baseDecay;
      const r = thickness * 0.5;

      nodes.push({
        x,
        y,
        r,
        angle,
        normDist
      });

      // Proximal anastomosis web bridging across base-to-mid trunks
      if (
        spec.isLeader &&
        !spec.isCapillary &&
        step >= 3 &&
        step <= 28 &&
        thickness >= 4.8
      ) {
        const estimatedPhase = lerp(
          spec.startPhase,
          spec.endPhase,
          clamp(step / Math.max(1, spec.maxSteps * 0.75), 0, 1)
        );
        const curAnchor: TrunkAnchor = {
          x,
          y,
          step,
          trunkId: spec.trunkId,
          thickness,
          phase: estimatedPhase
        };

        if (bridgesCreated < maxBridges && step % 3 === 0) {
          const minBridgeDist = 26 * Math.pow(viewportScale, 0.5);
          const maxBridgeDist = 132 * Math.pow(viewportScale, 0.65);

          for (let a = trunkAnchors.length - 1; a >= 0; a--) {
            const other = trunkAnchors[a];
            if (other.trunkId === spec.trunkId) continue;
            if (Math.abs(other.step - step) > 8) continue;

            const dAnchor = Math.hypot(x - other.x, y - other.y);
            if (
              dAnchor >= minBridgeDist &&
              dAnchor <= maxBridgeDist &&
              rng() < 0.46
            ) {
              const bridge = buildAnastomosisBridge(
                nextBranchId++,
                rng,
                curAnchor,
                other,
                originX,
                originY,
                maxDiagonal
              );
              branches.push(bridge);
              totalNodes += bridge.nodes.length;
              bridgesCreated++;
              break;
            }
          }
        }

        trunkAnchors.push(curAnchor);
      }

      if (
        x < -outPad ||
        x > width + outPad ||
        y < -outPad ||
        y > height + outPad ||
        thickness < 0.32
      ) {
        break;
      }

      // Rich lateral needle capillaries along primary & secondary limbs
      const capProb = isCompact ? 0.11 : 0.16;
      if (
        !spec.isCapillary &&
        step > 3 &&
        thickness >= 1.0 &&
        thickness <= 14.0 &&
        deferredForks.length < 24 &&
        rng() < capProb
      ) {
        const sideSign = rng() < 0.5 ? 1 : -1;
        const capAngle = angle + sideSign * (0.48 + rng() * 0.56);
        const capThick = clamp(
          thickness * (0.26 + rng() * 0.16),
          0.65,
          2.6
        );
        deferredForks.push({
          nodeIndex: nodes.length - 1,
          angle: capAngle,
          targetAngle: capAngle + sideSign * (0.14 + rng() * 0.24),
          angularVel: sideSign * (0.04 + rng() * 0.07),
          thickness: capThick,
          maxParentRadius: r * 0.76,
          generation: spec.generation + 2,
          splitCount: spec.splitCount + 1,
          splitWait: 6,
          trunkId: spec.trunkId,
          seed: spec.seed + 19.7 + rng() * 30,
          isLeader: false,
          isCapillary: true,
          maxSteps: 16 + Math.floor(rng() * 20)
        });
      }

      // Abundant wide lateral branching especially from start through mid-field
      stepsSinceSplit++;
      const maxGen = spec.isLeader ? 6 : 4;
      const minSplitThick = spec.isCapillary ? 1.0 : 1.5;
      if (
        stepsSinceSplit >= nextSplitAt &&
        spec.generation < maxGen &&
        thickness > minSplitThick &&
        deferredForks.length < 28
      ) {
        stepsSinceSplit = 0;
        const denseEarlyZone = normDist < 0.65;
        nextSplitAt = spec.isLeader
          ? (denseEarlyZone ? 4 : 7) + Math.floor(rng() * 4)
          : (denseEarlyZone ? 5 : 7) + Math.floor(rng() * 5);

        const splitSign =
          (deferredForks.length + spec.trunkId) % 2 === 0
            ? rng() < 0.72
              ? 1
              : -1
            : rng() < 0.72
              ? -1
              : 1;
        const wideSpread = denseEarlyZone
          ? 0.40 + rng() * 0.36
          : 0.32 + rng() * 0.32;
        const branchDeflection = splitSign * wideSpread;
        const branchThick = thickness * (0.58 + rng() * 0.18);
        const promoteSubLeader =
          spec.isLeader &&
          normDist < 0.66 &&
          branchThick > 3.0 &&
          rng() < 0.52;

        deferredForks.push({
          nodeIndex: nodes.length - 1,
          angle: angle + branchDeflection,
          targetAngle: angle + branchDeflection * 0.92,
          angularVel: (rng() - 0.5) * 0.08,
          thickness: branchThick,
          maxParentRadius: r * 0.76,
          generation: spec.generation + 1,
          splitCount: spec.splitCount + 1,
          splitWait: 5,
          trunkId: spec.trunkId + 100 + step,
          seed: spec.seed + 13.9 + rng() * 17,
          isLeader: promoteSubLeader,
          isCapillary: !promoteSubLeader && branchThick < 1.25,
          maxSteps: promoteSubLeader
            ? isCompact
              ? 76
              : 102
            : isCompact
              ? 52
              : 70
        });

        // Subtle biomechanical counterweight on continuing trunk
        const counterDeflection = -splitSign * (0.05 + rng() * 0.09);
        angle += counterDeflection;
        targetAngle += counterDeflection * 0.32;
        thickness *= 0.93;
      }
    }

    if (nodes.length < 2) continue;

    applyNeedleTaper(nodes, false);

    const branch: RootBranch = {
      id: nextBranchId++,
      generation: spec.generation,
      isLeader: spec.isLeader,
      isCapillary: spec.isCapillary,
      isBridge: false,
      startPhase: spec.startPhase,
      endPhase: spec.endPhase,
      nodes,
      baked: false
    };

    branches.push(branch);
    totalNodes += nodes.length;

    const lastIdx = Math.max(1, nodes.length - 1);
    for (let f = 0; f < deferredForks.length; f++) {
      const fork = deferredForks[f];
      const hostNode = nodes[fork.nodeIndex];
      if (!hostNode || hostNode.r < 0.25) continue;

      const forkPhase = lerp(
        branch.startPhase,
        branch.endPhase,
        fork.nodeIndex / lastIdx
      );

      // Avoid spawning new twigs past 0.86 so every branch completes cleanly by 4.0s
      if (forkPhase > 0.86) continue;

      let childStart: number;
      let childEnd: number;

      if (fork.isCapillary || fork.generation >= 3) {
        childStart = Math.max(0.28, forkPhase);
        childEnd = Math.min(1.0, childStart + 0.16 + rng() * 0.16);
      } else {
        childStart = forkPhase;
        childEnd = Math.min(0.86, childStart + 0.24 + rng() * 0.14);
      }

      if (childEnd - childStart < 0.08) {
        childEnd = Math.min(1.0, childStart + 0.08);
      }

      pendingSpecs.push({
        x: hostNode.x,
        y: hostNode.y,
        angle: fork.angle,
        targetAngle: fork.targetAngle,
        angularVel: fork.angularVel,
        thickness: fork.thickness,
        maxParentRadius: Math.min(fork.maxParentRadius, hostNode.r * 0.76),
        generation: fork.generation,
        splitCount: fork.splitCount,
        splitWait: fork.splitWait,
        trunkId: fork.trunkId,
        seed: fork.seed,
        isLeader: fork.isLeader,
        isCapillary: fork.isCapillary,
        maxSteps: fork.maxSteps,
        startPhase: childStart,
        endPhase: childEnd
      });
    }
  }

  branches.sort((a, b) => a.startPhase - b.startPhase || a.id - b.id);
  return branches;
}

/**
 * Computes normalized left-hand perpendicular normals for an active polyline
 * using central differences at interior vertices for smooth joint bends.
 */
function computeNormals(points: ActivePoint[]): Array<{ nx: number; ny: number }> {
  const normals: Array<{ nx: number; ny: number }> = [];
  let prevNx = 0;
  let prevNy = 1;

  for (let i = 0; i < points.length; i++) {
    const pPrev = points[Math.max(0, i - 1)];
    const pNext = points[Math.min(points.length - 1, i + 1)];
    const dx = pNext.x - pPrev.x;
    const dy = pNext.y - pPrev.y;
    const len = Math.hypot(dx, dy);

    if (len > 1e-5) {
      prevNx = -dy / len;
      prevNy = dx / len;
    }
    normals.push({ nx: prevNx, ny: prevNy });
  }
  return normals;
}

/**
 * Renders an active or complete branch as ONE continuous closed Bezier ribbon
 * converging cleanly to a single needle vertex `(tipX, tipY)` (`r = 0`).
 * Always draws with `globalAlpha = 1.0` so forks and segments never create beads.
 */
function drawBranchRibbon(
  ctx: CanvasRenderingContext2D,
  branch: RootBranch,
  progress: number
): void {
  const nodes = branch.nodes;
  if (nodes.length < 2 || progress <= 0) return;

  const p = clamp(progress, 0, 1);
  const floatMaxIdx = p * (nodes.length - 1);
  if (floatMaxIdx <= 0.002) return;

  const active: ActivePoint[] = [];
  const lastFull = Math.floor(floatMaxIdx);
  const frac = floatMaxIdx - lastFull;

  for (let i = 0; i <= lastFull; i++) {
    active.push({
      x: nodes[i].x,
      y: nodes[i].y,
      r: nodes[i].r,
      normDist: nodes[i].normDist
    });
  }

  if (frac > 0.001 && lastFull + 1 < nodes.length) {
    const a = nodes[lastFull];
    const b = nodes[lastFull + 1];
    active.push({
      x: lerp(a.x, b.x, frac),
      y: lerp(a.y, b.y, frac),
      r: lerp(a.r, b.r, frac),
      normDist: lerp(a.normDist, b.normDist, frac)
    });
  }

  if (active.length < 2) return;

  // Apply live botanical needle spearhead when actively growing (`p < 1`)
  if (p < 1) {
    const taperSpan = Math.min(active.length - 1, 5);
    const startTaper = active.length - 1 - taperSpan;
    for (let k = 0; k <= taperSpan; k++) {
      const idx = startTaper + k;
      const t = k / taperSpan;
      active[idx].r *= Math.pow(1 - t, 1.35);
    }
    active[active.length - 1].r = 0;
  }

  const L = active.length - 1;
  const normals = computeNormals(active);

  const lx: number[] = new Array(active.length);
  const ly: number[] = new Array(active.length);
  const rx: number[] = new Array(active.length);
  const ry: number[] = new Array(active.length);

  for (let i = 0; i < active.length; i++) {
    const pt = active[i];
    const n = normals[i];
    lx[i] = pt.x + n.nx * pt.r;
    ly[i] = pt.y + n.ny * pt.r;
    rx[i] = pt.x - n.nx * pt.r;
    ry[i] = pt.y - n.ny * pt.r;
  }

  const tx0 = normals[0].ny;
  const ty0 = -normals[0].nx;
  const r0 = active[0].r;

  ctx.save();
  ctx.globalAlpha = 1.0;

  const basePt = active[0];
  const tipPt = active[L];
  const spanDist = Math.hypot(tipPt.x - basePt.x, tipPt.y - basePt.y);

  if (spanDist > 1.5) {
    const midPt = active[Math.floor(active.length * 0.5)];
    const grad = ctx.createLinearGradient(
      basePt.x,
      basePt.y,
      tipPt.x,
      tipPt.y
    );
    grad.addColorStop(0, interpolateRootColor(basePt.normDist));
    grad.addColorStop(0.5, interpolateRootColor(midPt.normDist));
    grad.addColorStop(1, interpolateRootColor(tipPt.normDist));
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = interpolateRootColor(basePt.normDist);
  }

  ctx.beginPath();
  ctx.moveTo(lx[0], ly[0]);

  if (L === 1) {
    ctx.lineTo(lx[1], ly[1]);
    if (tipPt.r > 0.01) {
      ctx.lineTo(rx[1], ry[1]);
    }
    ctx.lineTo(rx[0], ry[0]);
  } else {
    // Smooth quadratic left wall to needle tip
    ctx.lineTo((lx[0] + lx[1]) * 0.5, (ly[0] + ly[1]) * 0.5);
    for (let i = 1; i < L; i++) {
      const mx = (lx[i] + lx[i + 1]) * 0.5;
      const my = (ly[i] + ly[i + 1]) * 0.5;
      ctx.quadraticCurveTo(lx[i], ly[i], mx, my);
    }
    ctx.lineTo(lx[L], ly[L]);

    if (tipPt.r > 0.01) {
      ctx.lineTo(rx[L], ry[L]);
    }

    // Symmetric quadratic right wall back to base
    ctx.lineTo((rx[L] + rx[L - 1]) * 0.5, (ry[L] + ry[L - 1]) * 0.5);
    for (let i = L - 1; i >= 1; i--) {
      const mx = (rx[i] + rx[i - 1]) * 0.5;
      const my = (ry[i] + ry[i - 1]) * 0.5;
      ctx.quadraticCurveTo(rx[i], ry[i], mx, my);
    }
    ctx.lineTo(rx[0], ry[0]);
  }

  // Smooth tucked rear base curve anchored inside parent/corner edge
  ctx.quadraticCurveTo(
    basePt.x - tx0 * r0 * 1.15,
    basePt.y - ty0 * r0 * 1.15,
    lx[0],
    ly[0]
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Draws a subtle radial ambient crown centered directly on the viewport corner
 * vertex so all trunks visibly originate flush from the screen corner edge.
 */
function drawCornerCrownGlow(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number
): void {
  ctx.save();
  const grad = ctx.createRadialGradient(originX, originY, 4, originX, originY, 120);
  grad.addColorStop(0, "rgba(235, 188, 186, 0.52)");
  grad.addColorStop(0.45, "rgba(196, 167, 231, 0.18)");
  grad.addColorStop(1, "rgba(196, 167, 231, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(originX, originY, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function measureOrigin(corner: CornerId): OriginMetrics {
  const width = window.innerWidth;
  const height = window.innerHeight;

  const isLeft = corner === "top-left" || corner === "bottom-left";
  const isTop = corner === "top-left" || corner === "top-right";

  // Anchor right inside the exact screen corner vertex (no floating gap/stump)
  const originX = isLeft ? -2 : width + 2;
  const originY = isTop ? -2 : height + 2;
  const targetX = isLeft ? width : 0;
  const targetY = isTop ? height : 0;

  const diagAngle = Math.atan2(targetY - originY, targetX - originX);
  const maxDiagonal = Math.hypot(targetX - originX, targetY - originY) || 1;

  return {
    width,
    height,
    originX,
    originY,
    targetX,
    targetY,
    diagAngle,
    maxDiagonal
  };
}

export function initRootsBackground(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Clean up any legacy secondary pulse canvas left in DOM (e.g. during HMR)
  canvas.parentElement
    ?.querySelectorAll(".roots-canvas-pulse")
    .forEach((el) => el.remove());

  const bakedCanvas = document.createElement("canvas");
  const bakedCtx = bakedCanvas.getContext("2d");
  if (!bakedCtx) return;

  // Pick one unique session seed and corner at random per page load
  const sessionSeed =
    ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) ^ 0x5f3759df) >>> 0;
  const sessionCorner = CORNERS[sessionSeed % CORNERS.length];

  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  let rafId: number | null = null;
  let resizeTimer: number | null = null;

  function configureBuffers(width: number, height: number): void {
    const mainDpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.floor(width * mainDpr);
    canvas.height = Math.floor(height * mainDpr);
    ctx!.setTransform(mainDpr, 0, 0, mainDpr, 0, 0);

    bakedCanvas.width = canvas.width;
    bakedCanvas.height = canvas.height;
    bakedCtx!.setTransform(mainDpr, 0, 0, mainDpr, 0, 0);
  }

  function blitBakedToMain(): void {
    ctx!.save();
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    ctx!.drawImage(bakedCanvas, 0, 0);
    ctx!.restore();
  }

  function renderStatic(): void {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }

    const metrics = measureOrigin(sessionCorner);
    configureBuffers(metrics.width, metrics.height);

    ctx!.clearRect(0, 0, metrics.width, metrics.height);
    bakedCtx!.clearRect(0, 0, metrics.width, metrics.height);

    const branches = buildRootNetwork(metrics, sessionSeed);
    drawCornerCrownGlow(bakedCtx!, metrics.originX, metrics.originY);

    for (let i = 0; i < branches.length; i++) {
      drawBranchRibbon(bakedCtx!, branches[i], 1);
      branches[i].baked = true;
    }

    blitBakedToMain();
    canvas.classList.add("is-settled");
  }

  function runGrowthAnimation(): void {
    if (reducedMotionQuery.matches) {
      renderStatic();
      return;
    }

    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }

    canvas.classList.remove("is-settled");

    const metrics = measureOrigin(sessionCorner);
    configureBuffers(metrics.width, metrics.height);

    ctx!.clearRect(0, 0, metrics.width, metrics.height);
    bakedCtx!.clearRect(0, 0, metrics.width, metrics.height);

    const branches = buildRootNetwork(metrics, sessionSeed);
    drawCornerCrownGlow(bakedCtx!, metrics.originX, metrics.originY);

    const durationMs = 4000;
    const startTime = performance.now();

    function frame(now: number): void {
      const elapsed = now - startTime;
      const rawProgress = Math.min(1, elapsed / durationMs);

      // Bake newly completed branches once onto offscreen cache
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i];
        if (!b.baked && rawProgress >= b.endPhase) {
          drawBranchRibbon(bakedCtx!, b, 1);
          b.baked = true;
        }
      }

      // 1:1 device-pixel copy of finished branches
      blitBakedToMain();

      // Draw only actively growing wave branches with live needle tips
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i];
        if (b.baked || rawProgress < b.startPhase) continue;

        const span = Math.max(0.01, b.endPhase - b.startPhase);
        const linearLocal = clamp((rawProgress - b.startPhase) / span, 0, 1);
        const easedLocal = 1 - Math.pow(1 - linearLocal, 1.85);
        drawBranchRibbon(ctx!, b, easedLocal);
      }

      if (rawProgress < 1) {
        rafId = window.requestAnimationFrame(frame);
      } else {
        for (let i = 0; i < branches.length; i++) {
          const b = branches[i];
          if (!b.baked) {
            drawBranchRibbon(bakedCtx!, b, 1);
            b.baked = true;
          }
        }
        blitBakedToMain();
        rafId = null;

        // Hand off single unified pulse to CSS GPU opacity animation (0% JS CPU)
        canvas.classList.add("is-settled");
      }
    }

    rafId = window.requestAnimationFrame(frame);
  }

  runGrowthAnimation();

  reducedMotionQuery.addEventListener("change", () => {
    if (reducedMotionQuery.matches) {
      renderStatic();
    }
  });

  let lastWidth = window.innerWidth;
  let lastHeight = window.innerHeight;

  window.addEventListener(
    "resize",
    () => {
      const dw = Math.abs(window.innerWidth - lastWidth);
      const dh = Math.abs(window.innerHeight - lastHeight);
      if (dw < 48 && dh < 120) return;

      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        lastWidth = window.innerWidth;
        lastHeight = window.innerHeight;
        renderStatic();
      }, 180);
    },
    { passive: true }
  );
}
