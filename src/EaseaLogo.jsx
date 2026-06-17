// EaseaLogo.jsx — v14.1
// 參考原始設計稿：
// 多層半透明圓形疊加，粉橙+藍紫+冰藍，3個白色光點，氣泡水珠感

export default function EaseaLogo({
  size      = 48,
  showText  = true,
  textSize  = 15,
  className = "",
  style     = {},
}) {
  const id = `el${size}`;

  return (
    <div
      className={`easea-logo ${className}`}
      style={{ display:"inline-flex", alignItems:"center", gap: size * 0.16, ...style }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink:0, overflow:"visible" }}
        aria-hidden="true"
      >
        <defs>
          {/* ── 外層大圓：冰藍+淡紫，最透明 ── */}
          <radialGradient id={`${id}-outer`} cx="48%" cy="44%" r="50%">
            <stop offset="0%"   stopColor="#C8D8F8" stopOpacity="0.55" />
            <stop offset="45%"  stopColor="#B0C0F0" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#9EB0E8" stopOpacity="0.08" />
          </radialGradient>

          {/* ── 中層圓：藍紫，半透明 ── */}
          <radialGradient id={`${id}-mid`} cx="46%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#B8B0E8" stopOpacity="0.72" />
            <stop offset="40%"  stopColor="#A0A8E0" stopOpacity="0.52" />
            <stop offset="100%" stopColor="#8898D0" stopOpacity="0.10" />
          </radialGradient>

          {/* ── 內層圓：粉橙+暖白，偏上右 ── */}
          <radialGradient id={`${id}-inner`} cx="58%" cy="38%" r="50%">
            <stop offset="0%"   stopColor="#F4D8C8" stopOpacity="0.82" />
            <stop offset="35%"  stopColor="#E8C8B8" stopOpacity="0.58" />
            <stop offset="70%"  stopColor="#D0B0A8" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#C0A0A0" stopOpacity="0.00" />
          </radialGradient>

          {/* ── 核心：冰白高光，左上 ── */}
          <radialGradient id={`${id}-core`} cx="38%" cy="34%" r="40%">
            <stop offset="0%"   stopColor="#FFFFFF" stopOpacity="0.90" />
            <stop offset="40%"  stopColor="#EEF4FF" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#D8ECFF" stopOpacity="0.00" />
          </radialGradient>

          {/* 整體柔化，保留輪廓 */}
          <filter id={`${id}-soft`} x="-15%" y="-15%" width="130%" height="130%">
            <feGaussianBlur stdDeviation="1.8"/>
          </filter>

          {/* 光點柔化 */}
          <filter id={`${id}-dot`} x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="0.6"/>
          </filter>
        </defs>

        {/* ══ 層 1：外層薄紗（最大、最透明，略橫橢圓）══ */}
        <ellipse cx="50" cy="48" rx="45" ry="42"
          fill={`url(#${id}-outer)`}
          transform="rotate(-6 50 48)"
        />

        {/* ══ 層 2：中層薄紗（藍紫，偏下左，縱橢圓）══ */}
        <ellipse cx="46" cy="54" rx="34" ry="38"
          fill={`url(#${id}-mid)`}
          transform="rotate(8 46 54)"
        />

        {/* ══ 層 3：內層薄紗（粉橙，偏上右，略橫）══ */}
        <ellipse cx="56" cy="43" rx="30" ry="26"
          fill={`url(#${id}-inner)`}
          transform="rotate(-10 56 43)"
        />

        {/* ══ 層 4：核心高光（偏上左，小橢圓）══ */}
        <ellipse cx="48" cy="46" rx="22" ry="20"
          fill={`url(#${id}-core)`}
          transform="rotate(5 48 46)"
        />

        {/* ══ 邊緣柔化（外層輪廓，同樣用橢圓）══ */}
        <ellipse cx="50" cy="48" rx="45" ry="42"
          fill="none"
          stroke="rgba(180,195,240,0.15)"
          strokeWidth="3"
          transform="rotate(-6 50 48)"
          filter={`url(#${id}-soft)`}
        />

        {/* ══ 3 個白色光點 ══ */}
        {/* 參考原稿位置：左中、中下、右中偏上 */}

        {/* 光點 1 — 主光點，最亮，左中 */}
        <circle cx="36" cy="46" r="2.2"
          fill="white" opacity="0.92"
          filter={`url(#${id}-dot)`}
        >
          <animate attributeName="opacity"
            values="0.92;0.60;0.92" dur="4.5s" begin="0s" repeatCount="indefinite"/>
        </circle>

        {/* 光點 2 — 中等，中下 */}
        <circle cx="52" cy="60" r="1.4"
          fill="white" opacity="0.72"
          filter={`url(#${id}-dot)`}
        >
          <animate attributeName="opacity"
            values="0.72;0.35;0.72" dur="5.8s" begin="1.2s" repeatCount="indefinite"/>
        </circle>

        {/* 光點 3 — 最小，右中偏上 */}
        <circle cx="63" cy="42" r="0.9"
          fill="white" opacity="0.58"
          filter={`url(#${id}-dot)`}
        >
          <animate attributeName="opacity"
            values="0.58;0.22;0.58" dur="7.2s" begin="2.6s" repeatCount="indefinite"/>
        </circle>
      </svg>

      {showText && (
        <span
          className="easea-logo-text"
          style={{
            fontSize: textSize,
            fontWeight: 500,
            letterSpacing: "0.06em",
            lineHeight: 1,
          }}
        >
          <span className="easea-logo-ea">Ea</span>
          <span className="easea-logo-sea">sea</span>
        </span>
      )}
    </div>
  );
}
