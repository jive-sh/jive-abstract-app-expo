/**
 * The public surface of this abstract: the package.json shape an Expo app extending it must have. The
 * hooks themselves ship as the `jive-app-expo` command.
 */
export {
  ABSTRACT_KEY,
  EXPO_TOKEN_SECRET,
  AppExpoSchema,
  JivePackageConfig,
  NativePlatform,
  PREVIEW_ENVIRONMENT,
  PackageJsonSchema,
  type AppExpoConfig,
  type EnvironmentConfig,
  type NativeConfig,
  type PackageJson,
  type PreviewConfig,
} from "./internal/public/manifest";
