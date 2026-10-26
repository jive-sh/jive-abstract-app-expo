import { Text, View } from 'react-native';

/** Shows which environment's build this is, so a test can tell the deployments apart. */
export default function App() {
  return (
    <View>
      <Text testID="environment">{process.env.EXPO_PUBLIC_ENVIRONMENT_LABEL}</Text>
    </View>
  );
}
