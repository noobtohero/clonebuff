/**
 * Loading spinner component — shows an animated spinner while the AI is processing.
 */

import React, { useEffect, useState } from 'react';
import { Text } from 'ink';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface SpinnerProps {
  /** Optional message to display next to the spinner */
  message?: string;
  /** Optional character emoji to show instead of the braille spinner */
  characterEmoji?: string;
}

export function Spinner({ message, characterEmoji }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  // If character emoji is provided, use a cute character-themed spinner
  if (characterEmoji) {
    return (
      <Text>
        <Text>{characterEmoji}</Text>
        <Text color="yellow">{SPINNER_FRAMES[frame]}</Text>
        {message ? <Text> {message}</Text> : null}
      </Text>
    );
  }

  return (
    <Text>
      <Text color="cyan">{SPINNER_FRAMES[frame]}</Text>
      {message ? <Text> {message}</Text> : null}
    </Text>
  );
}
