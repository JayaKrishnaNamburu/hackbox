import { transform } from '@babel/standalone';
import { babelPlugin, buildExecutableModules, run } from './index';
import { FileMetaData } from './contracts/file-meta-data';
import { getFileMetaData } from '../utils/utils';
import { FS } from '../services/fs/fs';
import { CodeCache } from './services/code-cache/code-cache';

let someFileMetaData: FileMetaData;
// This is added by babel at the top when we transpile to es5
const useStrict = '"use strict";\n\n';

describe('Babel plugin', () => {
  beforeEach(() => {
    someFileMetaData = getFileMetaData('./hello.js');
    jest.resetAllMocks();
  });

  it('should update the default imports', () => {
    const code = `import welcome from './welcome';
    welcome();
    `;
    const expectedTransformedCode = `${useStrict}_WELCOME.___default();`;

    const transformedCode = transform(code, {
      presets: ['es2015'],
      plugins: [babelPlugin(someFileMetaData)]
    }).code;

    expect(transformedCode).toBe(expectedTransformedCode);
  });

  it('should update the named imports', () => {
    const code = `import { welcome } from './welcome';
    welcome();
    `;
    const expectedTransformedCode = `${useStrict}_WELCOME.welcome();`;

    const transformedCode = transform(code, {
      presets: ['es2015'],
      plugins: [babelPlugin(someFileMetaData)]
    }).code;

    expect(transformedCode).toBe(expectedTransformedCode);
  });

  it('should update the named imports with renames', () => {
    const code = `import { welcome as something } from './welcome';
    something();
    `;
    const expectedTransformedCode = `${useStrict}_WELCOME.welcome();`;

    const transformedCode = transform(code, {
      presets: ['es2015'],
      plugins: [babelPlugin(someFileMetaData)]
    }).code;

    expect(transformedCode).toBe(expectedTransformedCode);
  });

  it('should update fileMetadata with deps', () => {
    const code = `import dep1 from './modules/dep1';
      import dep2 from './modules/dep2';
      dep1();
      dep2();
      `;

    transform(code, {
      presets: ['es2015'],
      plugins: [babelPlugin(someFileMetaData)]
    });

    expect(someFileMetaData.deps).toEqual([
      getFileMetaData('./modules/dep1'),
      getFileMetaData('./modules/dep2')
    ]);
  });

  it('should return the exports as array', () => {
    const code = `const counter = 10, value = 2, renamedValue = 3;
    export { value, renamedValue as otherValue };
    export default counter;`;

    transform(code, {
      presets: ['es2015'],
      plugins: [babelPlugin(someFileMetaData)]
    });

    expect(someFileMetaData.exports).toEqual({
      ___default: 'counter',
      value: 'value',
      otherValue: 'renamedValue'
    });
  });

  it('should remove default exports', () => {
    const code = `const counter = 10;
    export default counter;`;
    const expectedTransformedCode = `${useStrict}var counter = 10;`;

    const transformedCode = transform(code, {
      presets: ['es2015'],
      plugins: [babelPlugin(someFileMetaData)]
    }).code;

    expect(transformedCode).toBe(expectedTransformedCode);
  });

  it('should remove named exports', () => {
    const code = `const counter = 10;
    export { counter };`;
    const expectedTransformedCode = `${useStrict}var counter = 10;`;

    const transformedCode = transform(code, {
      presets: ['es2015'],
      plugins: [babelPlugin(someFileMetaData)]
    }).code;

    expect(transformedCode).toBe(expectedTransformedCode);
  });
});

describe('buildExecutableModule()', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should create the function with required dependencies', async () => {
    const files = {
      './hello.js': `console.info('hello from hackbox');`
    };
    const fs = new FS(files);
    const module = (
      await buildExecutableModules(getFileMetaData('./hello.js'), fs)
    ).module;

    console.info = jest.fn();
    module();

    expect(console.info).toHaveBeenCalledWith('hello from hackbox');
  });

  it('should return the default export', async () => {
    const files = {
      './hello.js': `function hello() { console.info('hello from export'); }
      export default hello;`
    };
    const fs = new FS(files);
    const module = (
      await buildExecutableModules(getFileMetaData('./hello.js'), fs)
    ).module;

    console.info = jest.fn();
    const exports = module();
    // try running the default export
    exports.___default();

    expect(console.info).toHaveBeenCalledWith('hello from export');
  });

  it('should run with a dependency injected', async () => {
    const files = {
      './welcome.js': `function welcome() { console.info('hello from dep injection') }
      export default welcome;`,
      './hello.js': `import welcome from './welcome.js';
      welcome();`
    };
    const cache = CodeCache.getInstance();
    const fs = new FS(files);
    const entryModule = (
      await buildExecutableModules(getFileMetaData('./hello.js'), fs)
    ).module;

    console.info = jest.fn();
    // try running the module with the _WELCOME dependency
    const entryFunc = new Function(
      'entryModule',
      `entryModule(${cache.get('_WELCOME')?.module}())`
    );

    entryFunc(entryModule);

    expect(console.info).toHaveBeenCalledWith('hello from dep injection');
  });
});

describe('runModule', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // reset the cache
    CodeCache.getInstance().reset();
  });

  it('should run the modules with default imports, exports', async () => {
    const files = {
      './welcome.js': `function welcome() { console.info('hello from default import/export modules') }
      export default welcome;`,
      './hello.js': `import welcome from './welcome.js';
      welcome();`
    };
    const fs = new FS(files);

    console.info = jest.fn();
    await run(fs, './hello.js');

    expect(console.info).toHaveBeenCalledWith(
      'hello from default import/export modules'
    );
  });

  it('should run the modules with named imports, exports', async () => {
    const files = {
      './welcome.js': `function welcome() { console.info('hello from named import/export modules') }
      export { welcome };`,
      './hello.js': `import { welcome } from './welcome.js';
      welcome();`
    };
    const fs = new FS(files);

    console.info = jest.fn();
    await run(fs, './hello.js');

    expect(console.info).toHaveBeenCalledWith(
      'hello from named import/export modules'
    );
  });

  it('should run the modules with renamed imports', async () => {
    const files = {
      './welcome.js': `function welcome() { console.info('hello from renamed import modules') }
      export { welcome };`,
      './hello.js': `import { welcome as hello } from './welcome.js';
      hello();`
    };
    const fs = new FS(files);

    console.info = jest.fn();
    await run(fs, './hello.js');

    expect(console.info).toHaveBeenCalledWith(
      'hello from renamed import modules'
    );
  });

  it('should run the modules with renamed exports', async () => {
    const files = {
      './welcome.js': `function welcome() { console.info('hello from renamed exports modules') }
      export { welcome as something };`,
      './hello.js': `import { something as hello } from './welcome.js';
      hello();`
    };
    const fs = new FS(files);

    console.info = jest.fn();
    await run(fs, './hello.js');

    expect(console.info).toHaveBeenCalledWith(
      'hello from renamed exports modules'
    );
  });

  it('should throw error when module is not found', async () => {
    const files = {
      './hello.js': `import { something as hello } from './welcome.js';
      hello();`
    };
    const fs = new FS(files);

    try {
      await run(fs, './hello.js');
    } catch (err) {
      expect(err).toEqual(new Error(`module ./welcome.js does not exists`));
    }
  });
});
