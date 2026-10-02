// Minimal Web Speech API types. React Native's TS lib does not include the DOM speech
// definitions, and VoiceButton uses them only on web, so this declares just the surface it
// touches rather than pulling in the full "dom" lib.

interface SpeechRecognitionAlternative {
  readonly transcript: string;
}

interface SpeechRecognitionResult {
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent {
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(): void;
  stop(): void;
}
