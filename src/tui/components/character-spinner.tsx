/**
 * CharacterSpinner — animated character emoji with sparkle/bounce effects.
 *
 * Cycles through frames to create a gentle sparkle animation around
 * the character's emoji for thinking/loading/streaming states.
 *
 * Frame sequence (for 🐱):
 *   Frame 0:  🐱       (normal)
 *   Frame 1:  🐱✨     (sparkle trailing)
 *   Frame 2:  ✨🐱✨   (sparkles both sides)
 *   Frame 3:  ✨🐱     (sparkle leading)
 *   Frame 4:  🐱       (normal)
 *   Frame 5:  ⭐🐱     (star leading)
 *   Frame 6:  🐱⭐     (star trailing)
 *   Frame 7:  🐱       (normal — loop back)
 */

import React, { useEffect, useState } from 'react';
import { Text } from 'ink';

interface CharacterSpinnerProps {
  /** Character emoji to animate */
  emoji?: string;
  /** Optional message to display next to the spinner */
  message?: string;
  /** Animation speed in ms (default: 120) */
  speed?: number;
  /** Color for sparkle effects (default: yellow) */
  sparkleColor?: string;
}

/**
 * Generate animation frames for a character emoji.
 * Each frame is a string like "🐱✨", "✨🐱✨", etc.
 */
function generateFrames(emoji: string): string[] {
  // Ensure we have a valid emoji
  const e = emoji || '✦';
  return [
    ` ${e}   `,
    ` ${e}✨ `,
    ` ✨${e}✨`,
    ` ✨${e} `,
    ` ${e}   `,
    ` ⭐${e} `,
    ` ${e}⭐ `,
    ` ${e}   `,
  ];
}

export function CharacterSpinner({
  emoji,
  message,
  speed = 120,
  sparkleColor = 'yellow',
}: CharacterSpinnerProps) {
  const frames = React.useMemo(() => generateFrames(emoji ?? '✦'), [emoji]);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % frames.length);
    }, speed);
    return () => clearInterval(timer);
  }, [frames.length, speed]);

  // Determine if current frame has a sparkle (odd frames usually)
  const currentFrame = frames[frame] ?? frames[0]!;
  // Find sparkle chars in the frame
  const hasSparkle = currentFrame.includes('✨') || currentFrame.includes('⭐');

  return (
    <Text>
      <Text color={hasSparkle ? sparkleColor : undefined}>
        {currentFrame}
      </Text>
      {message ? <Text> {message}</Text> : null}
    </Text>
  );
}

// ─── Welcome emoji bounce (simpler, for welcome screen) ─────────────────────

/**
 * WelcomeBounce — subtle pulsing animation for the welcome screen character.
 * Cycles through: normal → sparkle → normal → sparkle
 */
export function WelcomeBounce({
  emoji,
  color,
}: {
  emoji?: string;
  color?: string;
}) {
  const frames = React.useMemo(() => {
    const e = emoji || '✦';
    return [
      `${e} `,
      `✨${e}✨`,
      ` ${e} `,
      ` ✨${e} `,
    ];
  }, [emoji]);

  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % frames.length);
    }, 600); // Slower — 600ms per frame
    return () => clearInterval(timer);
  }, [frames.length]);

  const currentFrame = frames[frame] ?? frames[0]!;
  const isSparkly = currentFrame.includes('✨');

  return (
    <Text bold color={isSparkly ? 'yellow' : color}>
      {currentFrame}
    </Text>
  );
}
