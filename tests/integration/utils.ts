import path from "path";
import { totalist } from "totalist";
import { preprocess } from "svelte/compiler";
import { readFile, writeFile } from "../../src/utils";
import { EXT_SVELTE } from "../../src/constants";
import { PreprocessorGroup } from "svelte/types/compiler/preprocess";

interface TestFilesOptions {
  name: string;
  outFileFormat?: "json";
  preprocessor?: Partial<PreprocessorGroup>[];
  onReadFile?: (content: string, filename: string) => string | object;
}

export async function testFiles(options: TestFilesOptions) {
  const input = path.resolve(__dirname, "input");
  const testFile = new RegExp(`^${options.name}.test`);

  await totalist(input, async (file, filename) => {
    if (testFile.test(file)) {
      let content = await readFile(filename, "utf-8");
      let outfile = filename.replace(/input/, "output");
      let result: string | object = "";

      if (options.onReadFile) {
        result = options.onReadFile.apply(null, [content, filename]);
      } else {
        const { code } = await preprocess(content, options.preprocessor!, {
          filename,
        });
        result = code;
      }

      if (options.outFileFormat === "json") {
        outfile = outfile.replace(EXT_SVELTE, ".json");
        result = JSON.stringify(result, null, 2);
      }

      await writeFile(outfile, result as string);
      console.info(`[tests:${options.name}] processed ${file}`);
    }
  });
}
