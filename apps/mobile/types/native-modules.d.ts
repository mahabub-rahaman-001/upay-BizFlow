/**
 * Type stub for @react-native-async-storage/async-storage.
 * The real package is listed in package.json; this declaration keeps TypeScript
 * happy until the package is installed from the registry.
 */
declare module "@react-native-async-storage/async-storage" {
  const AsyncStorage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    multiGet(keys: string[]): Promise<[string, string | null][]>;
    multiSet(pairs: [string, string][]): Promise<void>;
    getAllKeys(): Promise<string[]>;
    clear(): Promise<void>;
  };
  export default AsyncStorage;
}

/**
 * Type stub for @react-native-community/netinfo.
 */
declare module "@react-native-community/netinfo" {
  export interface NetInfoState {
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
    type: string;
  }

  export type NetInfoSubscription = () => void;

  const NetInfo: {
    fetch(): Promise<NetInfoState>;
    addEventListener(listener: (state: NetInfoState) => void): NetInfoSubscription;
  };

  export default NetInfo;
}

/**
 * Type stub for expo-av (used via dynamic import in VoiceButton).
 * The real package provides full types; this covers the subset we use.
 */
declare module "expo-av" {
  export namespace Audio {
    interface RecordingObject {
      stopAndUnloadAsync(): Promise<void>;
      getURI(): string | null;
    }
    const RecordingOptionsPresets: {
      HIGH_QUALITY: object;
    };
    function requestPermissionsAsync(): Promise<{ granted: boolean }>;
    function setAudioModeAsync(opts: object): Promise<void>;
    class Recording {
      static createAsync(opts: object): Promise<{ recording: Recording }>;
      stopAndUnloadAsync(): Promise<void>;
      getURI(): string | null;
    }
  }
}
