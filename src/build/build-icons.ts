import { toString } from "@carbon/icon-helpers";
import { getPackageJson, readFile, writeFile } from "../utils";
import { API_ICONS } from "../constants";
import { BuildApi } from "../build";

/**
 * @example
 * "Add16"
 * "Add20"
 */
export type IconName = string;

export interface BuildIcons extends BuildApi {
  icons: Record<IconName, CarbonIconModule>;
}

interface CarbonIconModule {
  attributes: Record<string, any>;
  children: string;
}

interface CarbonIconsMetadata {
  icons: Array<{
    output: Array<{
      moduleName: IconName;
      descriptor: { attrs: Record<string, any>; content: any[] };
    }>;
  }>;
}

(async () => {
  const pkg = getPackageJson("node_modules/@carbon/icons");
  const icons: BuildIcons = {
    metadata: {
      package: pkg.name!,
      version: pkg.version!,
    },
    icons: {},
  };

  const metadataJson = await readFile(
    "node_modules/@carbon/icons/metadata.json",
    "utf-8"
  );
  const metadata: CarbonIconsMetadata = JSON.parse(metadataJson);

  metadata.icons.map(({ output }) => {
    output.forEach((output) => {
      const { moduleName, descriptor } = output;

      icons.icons[moduleName] = {
        attributes: {
          width: descriptor.attrs.width,
          height: descriptor.attrs.height,
        },
        children: descriptor.content
          .map((element) => toString(element))
          .join(""),
      };
    });
  });

  await writeFile(
    API_ICONS,
    `export const icons = ${JSON.stringify(icons, null, 2)}`
  );
})();
