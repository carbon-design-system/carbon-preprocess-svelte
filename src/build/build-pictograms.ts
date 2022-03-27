import { toString } from "@carbon/icon-helpers";
import { getPackageJson, readFile, writeFile } from "../utils";
import { API_PICTOGRAMS } from "../constants";
import { BuildApi } from "../build";

/**
 * @example
 * "Airplane"
 * "ActiveServer"
 */
export type PictogramName = string;

export interface BuildPictograms extends BuildApi {
  pictograms: Record<PictogramName, CarbonPictogramModule>;
}

interface CarbonPictogramModule {
  attributes: Record<string, any>;
  children: string;
}

export interface CarbonPictogramsMetadata {
  icons: ReadonlyArray<{
    name: string;
    friendlyName: string;
    namespace: [];
    assets: [
      {
        filepath: string;
        source: string;
        optimized: {
          data: string;
          info: {};
          path: string;
        };
      }
    ];
    output: [
      pictogram: {
        moduleName: PictogramName;
        filepath: string;
        descriptor: {
          elem: "svg";
          attrs: {
            xmlns: "http://www.w3.org/2000/svg";
            viewBox: "0 0 48 48";
            width: "48";
            height: "48";
          };
          content: { elem: string; attrs: object }[];
          name: string;
        };
      }
    ];
    category: string;
  }>;
}

(async () => {
  const pkg = getPackageJson("node_modules/@carbon/pictograms");
  const pictograms: BuildPictograms = {
    metadata: {
      package: pkg.name!,
      version: pkg.version!,
      exports: 0,
    },
    pictograms: {},
  };

  const metadataJson = await readFile(
    "node_modules/@carbon/pictograms/metadata.json",
    "utf-8"
  );
  const metadata: CarbonPictogramsMetadata = JSON.parse(metadataJson);

  pictograms.metadata.exports = metadata.icons.length;

  metadata.icons.map(({ output }) => {
    output.forEach((output) => {
      const { moduleName, descriptor } = output;

      pictograms.pictograms[moduleName] = {
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
    API_PICTOGRAMS,
    `export const pictograms = ${JSON.stringify(pictograms, null, 2)}`
  );
})();
