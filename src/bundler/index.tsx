import { getFileMetaData } from '../utils/utils';
import { FileMetaData } from './contracts/file-meta-data';
import { FS } from '../services/fs/fs';
import { transform } from '@babel/standalone';
import { CodeCache } from './services/code-cache/code-cache';
import { ModuleDef } from './contracts/module-def';
import { ExportsMetaData } from './contracts/exports-meta-data';

const cache = CodeCache.getInstance();

export function babelPlugin(fileMetaData: FileMetaData): () => object {
  return (): object => ({
    visitor: {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      ImportDeclaration(path: any): void {
        const depMetaData = getFileMetaData(path.node.source.value);
        fileMetaData.deps.push(depMetaData);

        // check if there are any default imports
        const defaultImport = path.node.specifiers.find(
          (specifier: { type: string }) =>
            specifier.type === 'ImportDefaultSpecifier'
        );

        /*
        import hello from './hello.js';

        hello();
        ==============================
        above code is transformed into
        ==============================
        _HELLO.___default();
        */
        if (defaultImport) {
          path.scope.rename(
            defaultImport.local.name,
            `${depMetaData.canocialName}.___default`
          );
        }
        // check if there are any named imports and transform them
        const namedImports = path.node.specifiers.filter(
          (specifier: { type: string }) => specifier.type === 'ImportSpecifier'
        );

        /*
        import { hello as something } from './hello.js';

        something();
        ==============================
        above code is transformed into
        ==============================
        _HELLO.hello();
        */
        for (const namedImport of namedImports) {
          // namedImport.local.name => something
          // nmaedImport.imported.name => hello
          path.scope.rename(
            namedImport.local.name,
            `${depMetaData.canocialName}.${namedImport.imported.name}`
          );
        }

        path.remove();
      },
      ExportDefaultDeclaration(path: any): void {
        fileMetaData.exports.___default = path.node.declaration.name;
        /*
        function hello() {
          console.log('hello world');
        }

        export default hello;
        ==============================
        above code is transformed into
        ==============================
        function hello() {
          console.log('hello world');
        }
        */
        path.remove();
      },
      ExportNamedDeclaration(path: any): void {
        // check if there are any named exports and transform them
        const namedExports = path.node.specifiers.filter(
          (specifier: { type: string }) => specifier.type === 'ExportSpecifier'
        );

        /*
        function hello() {
          console.log('hello world');
        }

        export { hello as something };
        ==============================
        above code is transformed into
        ==============================
        function hello() {
          console.log('hello world');
        }
        */
        for (const namedExport of namedExports) {
          // namedExport.local.name => hello
          // nmaedExport.exported.name => something
          fileMetaData.exports[namedExport.exported.name] =
            namedExport.local.name;
        }

        path.remove();
      }
    }
  });
}

/*
import hello from './hello.js';

hello();

function myHello() { console.log('my hello func') }

export default myHello;
==============================
above code is transformed into
==============================
function module(_HELLO) {
  _HELLO.___default();

  function myHello() { console.log('my hello func') }

  return {
    ___default: myHello
  }
}
*/
export async function buildExecutableModules(
  fileMetaData: FileMetaData,
  fs: FS
): Promise<ModuleDef> {
  let fileContent = '';

  try {
    fileContent = await fs.readFile(fileMetaData.path);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`module ${fileMetaData.path} does not exists`);
    } else {
      throw err;
    }
  }

  let transformedCode = (transform(fileContent, {
    presets: ['es2015'],
    plugins: [babelPlugin(fileMetaData)]
  }) as any).code;

  /*
  _HELLO.___default();

  function hello() { console.log('hello world'); }

  export default hello;
  ==============================
  above code is transformed into
  ==============================
  _HELLO.___default();

  function hello() { console.log('hello world'); }
  
  return {
    ___default: hello
  }
  */
  const exports = [];

  for (const exportKey in fileMetaData.exports) {
    const exportedRef = fileMetaData.exports[exportKey];

    if (exportedRef && exportedRef.trim().length > 0) {
      exports.push(`${exportKey}: ${fileMetaData.exports[exportKey]}`);
    }
  }
  const returnValue = `{${exports.join(',')}}`;
  /*
    return {
      ___default: hello
    }
  */
  transformedCode += `;return ${returnValue};`;

  /*
  _HELLO.___default();

  function hello() { console.log('hello world'); }
  
  return {
    ___default: hello
  }
  ==============================
  above code is transformed into
  ==============================
  function(_HELLO) {
    _HELLO.___default();

    function hello() { console.log('hello world'); }
  
    return {
      ___default: hello
    }
  }
  */
  // build the executable modules of all the dependencies first
  for (const dep of fileMetaData.deps) {
    // check if the module is already built or not
    if (!cache.get(dep.canocialName)) {
      // transform that dependency and cache it
      await buildExecutableModules(dep, fs);
    }
  }

  const depArgs = fileMetaData.deps.map((dep) => dep.canocialName);
  const moduleDef: ModuleDef = {
    module: new Function(...depArgs, transformedCode),
    deps: depArgs
  };
  // add module to the code cache
  cache.set(fileMetaData.canocialName, moduleDef);

  return moduleDef;
}

export function runModule(moduleDef: ModuleDef): ExportsMetaData {
  const depRefs: ExportsMetaData[] = [];

  for (const dep of moduleDef.deps) {
    const depModuleDef = cache.get(dep);

    if (depModuleDef) {
      const depRef = runModule(depModuleDef);

      depRefs.push(depRef);
    }
  }

  return moduleDef.module(...depRefs);
}

export async function run(fs: FS, entryFile: string): Promise<void> {
  // clear the cache
  CodeCache.getInstance().reset();
  const entryFileMetaData = getFileMetaData(entryFile);
  // build all the executable modules
  const entryModuleDef = await buildExecutableModules(entryFileMetaData, fs);
  // now all the transformed files are in the cache and we can run the entry module
  runModule(entryModuleDef);
}
