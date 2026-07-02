import { Suspense, useRef, useMemo, Component } from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import * as THREE from "three";

type SceneStatus = "idle" | "speaking" | "listening" | "processing";

/* ─────────────────────────────────────────────────────────────────────────────
   Realistic interviewer = a Ready Player Me GLB avatar loaded at runtime from the
   RPM CDN (with ARKit + Oculus-viseme morph targets). It is animated for life:
   eye blinks, idle head/neck motion, breathing, and lip-sync (jaw + visemes)
   while the AI is speaking. If the model can't load (offline / blocked), we fall
   back to a fully-offline procedural avatar so the room is never empty.
   ───────────────────────────────────────────────────────────────────────────── */

// Realistic interviewer avatar. Prefer a self-hosted copy at /interviewer-avatar.glb
// (drop a Ready Player Me .glb there for full offline reliability); otherwise load
// from the RPM CDN in the browser. If neither loads, the procedural avatar renders.
// NOTE: the URL must NOT use a `quality` preset (it strips morph targets). ARKit +
// Oculus Visemes morphs are requested explicitly; casing/space (%20) are exact.
const RPM_CDN_URL =
  "https://models.readyplayer.me/6185a4acfb622cf1cdc49348.glb?morphTargets=ARKit,Oculus%20Visemes&textureAtlas=1024";
const RPM_AVATAR_URL = RPM_CDN_URL;

/* ── helpers ─────────────────────────────────────────────────────────────── */
type MorphMesh = THREE.Mesh & {
  morphTargetDictionary: Record<string, number>;
  morphTargetInfluences: number[];
};

function setMorph(meshes: MorphMesh[], name: string, value: number) {
  for (const m of meshes) {
    const idx = m.morphTargetDictionary[name];
    if (idx !== undefined) m.morphTargetInfluences[idx] = value;
  }
}
function lerpMorph(meshes: MorphMesh[], name: string, target: number, t: number) {
  for (const m of meshes) {
    const idx = m.morphTargetDictionary[name];
    if (idx !== undefined) {
      const cur = m.morphTargetInfluences[idx] ?? 0;
      m.morphTargetInfluences[idx] = cur + (target - cur) * t;
    }
  }
}

/* ── Ready Player Me avatar ──────────────────────────────────────────────── */
function RPMAvatar({ status }: { status: SceneStatus }) {
  const { scene } = useGLTF(RPM_AVATAR_URL);
  const speaking = status === "speaking";
  const listening = status === "listening";
  const seed = useMemo(() => Math.random() * 10, []);

  // Collect all meshes that carry morph targets (Wolf3D_Head, Wolf3D_Teeth, eyes…)
  const meshes = useMemo(() => {
    const list: MorphMesh[] = [];
    scene.traverse((o) => {
      const m = o as MorphMesh;
      if (m.morphTargetDictionary && m.morphTargetInfluences) list.push(m);
    });
    return list;
  }, [scene]);

  // Find the bones we gently animate (exact match first, then fuzzy)
  const bones = useMemo(() => {
    const exact = (name: string) => {
      let b: THREE.Object3D | null = null;
      scene.traverse((o) => { if (!b && (o as THREE.Bone).isBone && o.name === name) b = o; });
      return b;
    };
    const fuzzy = (needle: string, avoid?: string) => {
      let b: THREE.Object3D | null = null;
      scene.traverse((o) => {
        if (!b && (o as THREE.Bone).isBone) {
          const n = o.name.toLowerCase();
          if (n.includes(needle) && (!avoid || !n.includes(avoid))) b = o;
        }
      });
      return b;
    };
    return {
      head: exact("Head") || fuzzy("head", "wear"),
      neck: exact("Neck") || fuzzy("neck"),
      spine: exact("Spine2") || exact("Spine1") || exact("Spine") || fuzzy("spine"),
    };
  }, [scene]);

  // Capture rest rotations once so we add deltas instead of overwriting the rig.
  const rest = useRef<{ head?: THREE.Euler; neck?: THREE.Euler; spine?: THREE.Euler } | null>(null);
  if (!rest.current) {
    rest.current = {
      head: bones.head ? (bones.head as THREE.Object3D).rotation.clone() : undefined,
      neck: bones.neck ? (bones.neck as THREE.Object3D).rotation.clone() : undefined,
      spine: bones.spine ? (bones.spine as THREE.Object3D).rotation.clone() : undefined,
    };
  }

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime + seed;
    const k = Math.min(1, delta * 14); // morph smoothing factor

    // ── Blink: a quick smooth close ~every 4.2s ──────────────────────────
    const cyc = t % 4.2;
    const blink = cyc < 0.13 ? Math.sin((cyc / 0.13) * Math.PI) : 0;
    setMorph(meshes, "eyeBlinkLeft", blink);
    setMorph(meshes, "eyeBlinkRight", blink);

    // ── Mouth: lip-sync while speaking, else relaxed (faint smile) ───────
    let jaw = 0, aa = 0, oh = 0, ee = 0, smileL = 0.05, smileR = 0.05;
    if (speaking) {
      const env = Math.sin(t * 9) * 0.5 + 0.5;       // slow open/close envelope
      const fast = Math.sin(t * 21) * 0.5 + 0.5;      // faster flutter
      jaw = 0.10 + env * 0.32 + fast * 0.05;
      aa = env * 0.55;
      oh = (1 - env) * 0.32;
      ee = fast * 0.22;
      smileL = smileR = 0.04;
    } else if (listening) {
      smileL = smileR = 0.18;                          // attentive, friendly
    }
    lerpMorph(meshes, "jawOpen", jaw, k);
    lerpMorph(meshes, "viseme_aa", aa, k);
    lerpMorph(meshes, "viseme_O", oh, k);
    lerpMorph(meshes, "viseme_E", ee, k);
    lerpMorph(meshes, "mouthSmileLeft", smileL, k);
    lerpMorph(meshes, "mouthSmileRight", smileR, k);

    // ── Idle head / neck motion + lean-in when listening ─────────────────
    const r = rest.current!;
    if (bones.head && r.head) {
      const h = bones.head as THREE.Object3D;
      h.rotation.x = r.head.x + Math.sin(t * 0.5) * 0.03 + (listening ? 0.09 : 0);
      h.rotation.y = r.head.y + Math.sin(t * 0.33) * 0.06 + Math.sin(t * 0.13) * 0.03;
      h.rotation.z = r.head.z + Math.sin(t * 0.27) * 0.015;
    }
    if (bones.neck && r.neck) {
      const n = bones.neck as THREE.Object3D;
      n.rotation.x = r.neck.x + Math.sin(t * 0.5) * 0.015 + (listening ? 0.04 : 0);
      n.rotation.y = r.neck.y + Math.sin(t * 0.33) * 0.025;
    }
    // ── Breathing ────────────────────────────────────────────────────────
    if (bones.spine && r.spine) {
      const s = bones.spine as THREE.Object3D;
      s.rotation.x = r.spine.x + Math.sin(t * 0.9) * 0.012;
    }
  });

  // Feet sit near y=0; drop the model so the head lands at the camera's eye line.
  return <primitive object={scene} position={[0, -1.48, 0]} />;
}

useGLTF.preload(RPM_AVATAR_URL);

/* ── Procedural fallback avatar (fully offline) ──────────────────────────── */
const SKIN = "#eab690";
const SKIN_LIGHT = "#f6cda6";
const HAIR = "#43301f";
const HAIR_HI = "#5b4329";
const TEE = "#1c1d24";
const TEE_HI = "#2a2c36";
const BLUSH = "#e8917e";
const LIP = "#c06a5a";

function ProceduralInterviewer({ status }: { status: SceneStatus }) {
  const group = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const leftLid = useRef<THREE.Mesh>(null);
  const rightLid = useRef<THREE.Mesh>(null);
  const leftBrow = useRef<THREE.Mesh>(null);
  const rightBrow = useRef<THREE.Mesh>(null);
  const mouth = useRef<THREE.Mesh>(null);

  const speaking = status === "speaking";
  const listening = status === "listening";
  const seed = useMemo(() => Math.random() * 10, []);
  const skinMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.5, metalness: 0.02 }),
    [],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime + seed;
    if (group.current) {
      group.current.position.y = -0.05 + Math.sin(t * 0.9) * 0.015;
      group.current.rotation.z = Math.sin(t * 0.45) * 0.008;
    }
    if (head.current) {
      head.current.rotation.y = Math.sin(t * 0.33) * 0.06 + Math.sin(t * 0.13) * 0.035;
      head.current.rotation.x = Math.sin(t * 0.5) * 0.025 + (listening ? 0.06 : 0);
      head.current.rotation.z = Math.sin(t * 0.27) * 0.012 + (listening ? 0.025 : 0);
      head.current.position.z = listening ? 0.05 : 0;
    }
    if (eyes.current) {
      const sacc = Math.sin(t * 0.7) * 0.01 + (Math.sin(t * 2.3) > 0.97 ? 0.025 : 0);
      eyes.current.position.x = sacc;
      eyes.current.position.y = Math.sin(t * 0.55) * 0.007;
    }
    if (mouth.current) {
      if (speaking) {
        const open = Math.max(0, Math.sin(t * 16) * 0.6 + Math.sin(t * 27) * 0.4);
        const amt = open * 0.5 + 0.5;
        mouth.current.scale.set(1.6, 0.35 + amt * 0.95, 0.5);
      } else {
        mouth.current.scale.set(1.6, 0.32, 0.5);
      }
    }
    const blink = Math.sin(t * 1.15);
    const closed = blink > 0.982 ? 0.06 : 1;
    if (leftLid.current) leftLid.current.scale.y = closed;
    if (rightLid.current) rightLid.current.scale.y = closed;
    const browRaise = (speaking && Math.sin(t * 3.1) > 0.6 ? 0.018 : 0) + (listening ? 0.012 : 0);
    if (leftBrow.current) leftBrow.current.position.y = 0.22 + browRaise;
    if (rightBrow.current) rightBrow.current.position.y = 0.22 + browRaise;
  });

  return (
    <group ref={group} scale={0.52} position={[0, 0.06, 0]}>
      <mesh position={[0, -1.25, 0]} castShadow>
        <capsuleGeometry args={[0.66, 0.9, 10, 28]} />
        <meshStandardMaterial color={TEE} roughness={0.85} metalness={0.02} />
      </mesh>
      <mesh position={[0, -0.7, 0]} castShadow>
        <sphereGeometry args={[0.82, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={TEE_HI} roughness={0.85} />
      </mesh>
      <mesh position={[0, -0.42, 0.12]} rotation={[Math.PI / 2.2, 0, 0]}>
        <torusGeometry args={[0.22, 0.04, 12, 32]} />
        <meshStandardMaterial color={TEE_HI} roughness={0.8} />
      </mesh>
      <mesh position={[0, -0.34, 0.04]}>
        <cylinderGeometry args={[0.17, 0.21, 0.32, 20]} />
        <primitive object={skinMat} attach="material" />
      </mesh>
      <group ref={head} position={[0, 0.18, 0.04]}>
        <mesh castShadow scale={[1.04, 1.12, 1.04]}>
          <sphereGeometry args={[0.42, 48, 48]} />
          <primitive object={skinMat} attach="material" />
        </mesh>
        <mesh position={[0, -0.16, 0.08]} scale={[1.02, 0.92, 1]}>
          <sphereGeometry args={[0.36, 32, 32]} />
          <primitive object={skinMat} attach="material" />
        </mesh>
        <mesh position={[0, -0.32, 0.06]} scale={[0.9, 0.78, 0.92]}>
          <sphereGeometry args={[0.3, 32, 32]} />
          <primitive object={skinMat} attach="material" />
        </mesh>
        <mesh position={[0, 0.24, 0.34]} scale={[0.9, 0.7, 0.4]}>
          <sphereGeometry args={[0.22, 24, 24]} />
          <meshStandardMaterial color={SKIN_LIGHT} roughness={0.5} transparent opacity={0.4} />
        </mesh>
        <mesh position={[0, 0.2, -0.02]} scale={[1.12, 1.16, 1.12]} castShadow>
          <sphereGeometry args={[0.4, 40, 32, 0, Math.PI * 2, 0, Math.PI / 1.7]} />
          <meshStandardMaterial color={HAIR} roughness={0.9} />
        </mesh>
        <mesh position={[-0.18, 0.42, 0.16]} scale={[0.5, 0.5, 0.5]}>
          <sphereGeometry args={[0.34, 24, 20]} />
          <meshStandardMaterial color={HAIR_HI} roughness={0.88} />
        </mesh>
        <mesh position={[0.16, 0.46, 0.1]} scale={[0.46, 0.46, 0.46]}>
          <sphereGeometry args={[0.34, 24, 20]} />
          <meshStandardMaterial color={HAIR_HI} roughness={0.88} />
        </mesh>
        <mesh position={[-0.42, -0.02, 0.02]} scale={[0.7, 1, 0.8]}>
          <sphereGeometry args={[0.09, 16, 16]} />
          <primitive object={skinMat} attach="material" />
        </mesh>
        <mesh position={[0.42, -0.02, 0.02]} scale={[0.7, 1, 0.8]}>
          <sphereGeometry args={[0.09, 16, 16]} />
          <primitive object={skinMat} attach="material" />
        </mesh>
        <mesh position={[-0.22, -0.06, 0.36]} scale={[1, 0.7, 0.3]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial color={BLUSH} roughness={0.6} transparent opacity={0.4} />
        </mesh>
        <mesh position={[0.22, -0.06, 0.36]} scale={[1, 0.7, 0.3]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial color={BLUSH} roughness={0.6} transparent opacity={0.4} />
        </mesh>
        <group ref={eyes}>
          <mesh position={[-0.16, 0.05, 0.38]} scale={[1.05, 0.95, 1]}>
            <sphereGeometry args={[0.085, 24, 24]} />
            <meshStandardMaterial color="#ffffff" roughness={0.2} />
          </mesh>
          <mesh position={[0.16, 0.05, 0.38]} scale={[1.05, 0.95, 1]}>
            <sphereGeometry args={[0.085, 24, 24]} />
            <meshStandardMaterial color="#ffffff" roughness={0.2} />
          </mesh>
          <mesh position={[-0.16, 0.04, 0.45]}>
            <circleGeometry args={[0.05, 24]} />
            <meshStandardMaterial color="#5a3a20" roughness={0.3} />
          </mesh>
          <mesh position={[0.16, 0.04, 0.45]}>
            <circleGeometry args={[0.05, 24]} />
            <meshStandardMaterial color="#5a3a20" roughness={0.3} />
          </mesh>
          <mesh position={[-0.16, 0.04, 0.452]}>
            <circleGeometry args={[0.025, 20]} />
            <meshStandardMaterial color="#160d05" />
          </mesh>
          <mesh position={[0.16, 0.04, 0.452]}>
            <circleGeometry args={[0.025, 20]} />
            <meshStandardMaterial color="#160d05" />
          </mesh>
          <mesh position={[-0.14, 0.072, 0.456]}>
            <circleGeometry args={[0.015, 12]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.8} />
          </mesh>
          <mesh position={[0.18, 0.072, 0.456]}>
            <circleGeometry args={[0.015, 12]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.8} />
          </mesh>
        </group>
        <mesh ref={leftLid} position={[-0.16, 0.1, 0.4]} scale={[1.1, 1, 1]}>
          <sphereGeometry args={[0.088, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <primitive object={skinMat} attach="material" />
        </mesh>
        <mesh ref={rightLid} position={[0.16, 0.1, 0.4]} scale={[1.1, 1, 1]}>
          <sphereGeometry args={[0.088, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <primitive object={skinMat} attach="material" />
        </mesh>
        <mesh position={[-0.16, 0.04, 0.46]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.11, 0.012, 12, 28]} />
          <meshStandardMaterial color="#20202a" roughness={0.3} metalness={0.4} />
        </mesh>
        <mesh position={[0.16, 0.04, 0.46]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.11, 0.012, 12, 28]} />
          <meshStandardMaterial color="#20202a" roughness={0.3} metalness={0.4} />
        </mesh>
        <mesh position={[0, 0.04, 0.46]}>
          <boxGeometry args={[0.11, 0.012, 0.012]} />
          <meshStandardMaterial color="#20202a" metalness={0.4} />
        </mesh>
        <mesh ref={leftBrow} position={[-0.16, 0.22, 0.4]} rotation={[0, 0, 0.12]}>
          <boxGeometry args={[0.15, 0.024, 0.05]} />
          <meshStandardMaterial color={HAIR} roughness={0.85} />
        </mesh>
        <mesh ref={rightBrow} position={[0.16, 0.22, 0.4]} rotation={[0, 0, -0.12]}>
          <boxGeometry args={[0.15, 0.024, 0.05]} />
          <meshStandardMaterial color={HAIR} roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.0, 0.45]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.03, 0.05, 0.2, 12]} />
          <primitive object={skinMat} attach="material" />
        </mesh>
        <mesh position={[0, -0.1, 0.48]}>
          <sphereGeometry args={[0.05, 16, 16]} />
          <primitive object={skinMat} attach="material" />
        </mesh>
        <mesh ref={mouth} position={[0, -0.18, 0.46]} scale={[1.6, 0.32, 0.5]}>
          <sphereGeometry args={[0.06, 20, 16]} />
          <meshStandardMaterial color="#7a3b30" roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.135, 0.47]} rotation={[0, 0, Math.PI]} scale={[1, 0.7, 1]}>
          <torusGeometry args={[0.06, 0.012, 8, 20, Math.PI]} />
          <meshStandardMaterial color={LIP} roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
}

/* ── Error boundary: swap to the procedural avatar if the GLB fails ──────── */
class AvatarErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* offline / blocked CDN — silently use fallback */ }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/* ── Lights ──────────────────────────────────────────────────────────────── */
function Lights({ status }: { status: SceneStatus }) {
  const accent =
    status === "speaking" ? "#a78bfa" :
    status === "listening" ? "#7dd3fc" :
    status === "processing" ? "#fcd34d" :
    "#c4b5fd";
  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[2, 4, 4]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-3, 2, 3]} intensity={0.55} color="#dfe6ff" />
      <pointLight position={[0, 0.6, 3]} intensity={0.9} color="#fff4ea" distance={9} />
      <pointLight position={[-2, 1.6, 1.4]} intensity={1.1} color={accent} distance={9} />
    </>
  );
}

export default function InterviewScene3D({ status }: { status: SceneStatus }) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 0.15, 1.3], fov: 32 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ camera }) => camera.lookAt(0, 0.15, 0)}
      style={{ width: "100%", height: "100%" }}
    >
      {/* No background/fog — the page's lavender shows through (alpha canvas). */}
      <Lights status={status} />
      <AvatarErrorBoundary fallback={<ProceduralInterviewer status={status} />}>
        <Suspense fallback={<ProceduralInterviewer status={status} />}>
          <RPMAvatar status={status} />
        </Suspense>
      </AvatarErrorBoundary>
      <Environment preset="apartment" />
    </Canvas>
  );
}
