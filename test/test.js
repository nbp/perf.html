import 'babel-polyfill';
import { assert, config } from 'chai';
import { getContainingLibrary, symbolicateProfile, applyFunctionMerging, setFuncNames } from '../src/content/symbolication';
import { preprocessProfile, unserializeProfileOfArbitraryFormat, serializeProfile } from '../src/content/preprocess-profile';
import { resourceTypes, getFuncStackInfo, getTracingMarkers } from '../src/content/profile-data';
import exampleProfile from './example-profile';
import { UniqueStringArray } from '../src/content/unique-string-array';
import { FakeSymbolStore } from './fake-symbol-store';
import { sortDataTable } from '../src/content/data-table-utils';
import { isOldCleopatraFormat, convertOldCleopatraProfile } from '../src/content/old-cleopatra-profile-format';
import { isPreprocessedProfile, upgradePreprocessedProfileToCurrentVersion } from '../src/content/preprocessed-profile-versioning';
import { upgradeRawProfileToCurrentVersion } from '../src/content/raw-profile-versioning';
import { getImplementationColor, getCategoryByImplementation, implementationCategoryMap } from '../src/content/color-categories';

config.truncateThreshold = 0;

describe('unique-string-array', function () {
  const u = new UniqueStringArray(['foo', 'bar', 'baz']);
  it('should return the right strings', function () {
    assert.equal(u.getString(0), 'foo');
    assert.equal(u.getString(1), 'bar');
    assert.equal(u.getString(2), 'baz');
  });
  it('should return the correct index for existing strings', function () {
    assert.equal(u.indexForString('foo'), 0);
    assert.equal(u.indexForString('bar'), 1);
    assert.equal(u.indexForString('baz'), 2);
  });
  it('should return a new index for a new string', function () {
    assert.equal(u.indexForString('qux'), 3);
    assert.equal(u.indexForString('qux'), 3);
    assert.equal(u.indexForString('hello'), 4);
    assert.equal(u.indexForString('bar'), 1);
    assert.equal(u.indexForString('qux'), 3);
    assert.equal(u.getString(3), 'qux');
    assert.equal(u.getString(4), 'hello');
  });
});

describe('data-table-utils', function () {
  describe('sortDataTable', function () {
    const originalDataTable = {
      length: 6,
      word: ['a', 'is', 'now', 'This', 'array', 'sorted'],
      order: [13, 0.7, 2, -0.2, 100, 20.1],
      wordLength: [1, 2, 3, 4, 5, 6],
    };
    const dt = JSON.parse(JSON.stringify(originalDataTable));
    it('test preparation', function () {
      // verify copy
      assert.notEqual(dt, originalDataTable);
      assert.deepEqual(dt, originalDataTable);
      assert.deepEqual(dt.word.map(w => w.length), dt.wordLength, 'wordLength is correct');
    });
    it('should sort this data table by order', function () {
      // sort by order
      sortDataTable(dt, dt.order, (a, b) => a - b);

      assert.equal(dt.length, originalDataTable.length, 'length should be unaffected');
      assert.equal(dt.word.length, originalDataTable.length, 'length should be unaffected');
      assert.equal(dt.order.length, originalDataTable.length, 'length should be unaffected');
      assert.equal(dt.wordLength.length, originalDataTable.length, 'length should be unaffected');
      assert.deepEqual(dt.word.map(w => w.length), dt.wordLength, 'wordLength is still correct (was adjusted the same way)');
      assert.deepEqual(dt.order, [...dt.order].sort((a, b) => a - b), 'dt.order is sorted');
      assert.equal(dt.word.join(' '), 'This is now a sorted array', 'dt.words was reordered the same way');
    });
    it('should sort this data table by wordLength', function () {
      // sort by wordLength
      sortDataTable(dt, dt.wordLength, (a, b) => a - b);
      assert.deepEqual(dt, originalDataTable);
    });
  });
});

describe('preprocess-profile', function () {
  describe('preprocessProfile', function () {
    const profile = preprocessProfile(exampleProfile);
    it('should have three threads', function () {
      assert.equal(profile.threads.length, 3);
    });
    it('should not have a profile-wide libs property', function () {
      assert.notProperty(profile, 'libs');
    });
    it('should have threads that are objects of the right shape', function () {
      for (const thread of profile.threads) {
        assert.equal(typeof thread, 'object');
        assert.property(thread, 'libs');
        assert.property(thread, 'samples');
        assert.property(thread, 'stackTable');
        assert.property(thread, 'frameTable');
        assert.property(thread, 'markers');
        assert.property(thread, 'stringTable');
        assert.property(thread, 'funcTable');
        assert.property(thread, 'resourceTable');
      }
    });
    it('should sort libs by start address', function () {
      const libs = profile.threads[0].libs;
      let lastStartAddress = -Infinity;
      for (const lib of libs) {
        assert.isAbove(lib.start, lastStartAddress);
        lastStartAddress = lib.start;
      }
    });
    it('should have reasonable debugName fields on each library', function () {
      assert.equal(profile.threads[0].libs[0].debugName, 'firefox');
      assert.equal(profile.threads[0].libs[1].debugName, 'examplebinary');
      assert.equal(profile.threads[0].libs[2].debugName, 'examplebinary2.pdb');
      assert.equal(profile.threads[1].libs[0].debugName, 'firefox');
      assert.equal(profile.threads[1].libs[1].debugName, 'examplebinary');
      assert.equal(profile.threads[1].libs[2].debugName, 'examplebinary2.pdb');

      // Thread 2 is the content process main thread
      assert.equal(profile.threads[2].libs[0].debugName, 'firefox-webcontent');
      assert.equal(profile.threads[2].libs[1].debugName, 'examplebinary');
      assert.equal(profile.threads[2].libs[2].debugName, 'examplebinary2.pdb');
    });
    it('should have reasonable breakpadId fields on each library', function () {
      for (const thread of profile.threads) {
        for (const lib of thread.libs) {
          assert.property(lib, 'breakpadId');
          assert.equal(lib.breakpadId.length, 33);
          assert.equal(lib.breakpadId, lib.breakpadId.toUpperCase());
        }
      }
    });
    it('should shift the content process by 1 second', function () {
      // Should be Content, but modified by workaround for bug 1322471.
      assert.equal(profile.threads[2].name, 'GeckoMain');

      assert.equal(profile.threads[0].samples.time[0], 0);
      assert.equal(profile.threads[0].samples.time[1], 1);
      assert.equal(profile.threads[2].samples.time[0], 1000);
      assert.equal(profile.threads[2].samples.time[1], 1001);
      assert.equal(profile.threads[0].markers.time[0], 0);
      assert.equal(profile.threads[0].markers.time[1], 2);
      assert.equal(profile.threads[0].markers.time[2], 4);
      assert.equal(profile.threads[0].markers.time[3], 5);
      assert.equal(profile.threads[0].markers.data[5].startTime, 9);
      assert.equal(profile.threads[0].markers.data[5].endTime, 10);
      assert.equal(profile.threads[2].markers.time[0], 1000);
      assert.equal(profile.threads[2].markers.time[1], 1002);
      assert.equal(profile.threads[2].markers.time[2], 1004);
      assert.equal(profile.threads[2].markers.time[3], 1005);
      assert.equal(profile.threads[2].markers.data[5].startTime, 1009);
      assert.equal(profile.threads[2].markers.data[5].endTime, 1010);
      // TODO: also shift the samples inside marker callstacks
    });
    it('should create one function per frame', function () {
      const thread = profile.threads[0];
      assert.equal(thread.frameTable.length, 5);
      assert.notProperty(thread.frameTable, 'location');
      assert.property(thread.frameTable, 'func');
      assert.property(thread.funcTable, 'resource');
      assert.equal(thread.funcTable.length, 5);
      assert.equal(thread.frameTable.func[0], 0);
      assert.equal(thread.frameTable.func[1], 1);
      assert.equal(thread.frameTable.func[2], 2);
      assert.equal(thread.frameTable.func[3], 3);
      assert.equal(thread.frameTable.func[4], 4);
      assert.equal(thread.frameTable.address[0], -1);
      assert.equal(thread.frameTable.address[1], 3972);
      assert.equal(thread.frameTable.address[2], 6725);
      assert.equal(thread.frameTable.address[3], -1);
      assert.equal(thread.frameTable.address[4], -1);
      assert.equal(thread.funcTable.name[0], 0);
      assert.equal(thread.funcTable.name[1], 1);
      assert.equal(thread.funcTable.name[2], 2);
      assert.equal(thread.funcTable.name[3], 3);
      assert.equal(thread.funcTable.name[4], 7);
      assert.equal(thread.funcTable.address[0], -1);
      assert.equal(thread.funcTable.address[1], 3972);
      assert.equal(thread.funcTable.address[2], 6725);
      assert.equal(thread.funcTable.address[3], -1);
      assert.equal(thread.funcTable.address[4], -1);
    });
    it('should create one resource per used library', function () {
      const thread = profile.threads[0];
      assert.equal(thread.resourceTable.length, 2);
      assert.equal(thread.resourceTable.type[0], resourceTypes.library);
      assert.equal(thread.resourceTable.type[1], resourceTypes.url);
      const [name0, name1] = thread.resourceTable.name;
      assert.equal(thread.stringTable.getString(name0), 'firefox');
      assert.equal(thread.stringTable.getString(name1), 'chrome://blargh');
    });
  });
});

describe('profile-data', function () {
  describe('createFuncStackTableAndFixupSamples', function () {
    const profile = preprocessProfile(exampleProfile);
    const thread = profile.threads[0];
    const { funcStackTable } =
      getFuncStackInfo(thread.stackTable, thread.frameTable, thread.funcTable, thread.samples);
    it('should create one funcStack per stack', function () {
      assert.equal(thread.stackTable.length, 5);
      assert.equal(funcStackTable.length, 5);
      assert.property(funcStackTable, 'prefix');
      assert.property(funcStackTable, 'func');
      assert.equal(funcStackTable.func[0], 0);
      assert.equal(funcStackTable.func[1], 1);
      assert.equal(funcStackTable.func[2], 2);
      assert.equal(funcStackTable.func[3], 3);
    });
  });
  describe('getTracingMarkers', function () {
    const profile = preprocessProfile(exampleProfile);
    const thread = profile.threads[0];
    const tracingMarkers = getTracingMarkers(thread);
    it('should fold the two reflow markers into one tracing marker', function () {
      assert.equal(tracingMarkers.length, 3);
      assert.deepEqual(tracingMarkers[0], {
        start: 2,
        name: 'Reflow',
        dur: 6,
        title: 'Reflow for 6.00ms',
      });
    });
    it('should fold the two Rasterize markers into one tracing marker, after the reflow tracing marker', function () {
      assert.equal(tracingMarkers.length, 3);
      assert.deepEqual(tracingMarkers[1], {
        start: 4,
        name: 'Rasterize',
        dur: 1,
        title: 'Rasterize for 1.00ms',
      });
    });
    it('should create a tracing marker for the MinorGC startTime/endTime marker', function () {
      assert.equal(tracingMarkers.length, 3);
      assert.deepEqual(tracingMarkers[2], {
        start: 11,
        name: 'MinorGC',
        dur: 1,
        title: 'MinorGC for 1.00ms',
      });
    });
  });
});

describe('symbolication', function () {
  describe('getContainingLibrary', function () {
    const libs = [
      { start: 0, end: 20, name: 'first' },
      { start: 20, end: 40, name: 'second' },
      { start: 40, end: 50, name: 'third' },
      { start: 60, end: 80, name: 'fourth' },
      { start: 80, end: 100, name: 'fifth' },
    ];
    it('should return the first library for addresses inside the first library', function () {
      assert.equal(getContainingLibrary(libs, 0).name, 'first');
      assert.equal(getContainingLibrary(libs, 10).name, 'first');
      assert.equal(getContainingLibrary(libs, 19).name, 'first');
    });
    it('should return the second library for addresses inside the second library', function () {
      assert.equal(getContainingLibrary(libs, 20).name, 'second');
      assert.equal(getContainingLibrary(libs, 21).name, 'second');
      assert.equal(getContainingLibrary(libs, 27).name, 'second');
      assert.equal(getContainingLibrary(libs, 39).name, 'second');
    });
    it('should return the third library for addresses inside the third library', function () {
      assert.equal(getContainingLibrary(libs, 40).name, 'third');
      assert.equal(getContainingLibrary(libs, 41).name, 'third');
      assert.equal(getContainingLibrary(libs, 47).name, 'third');
      assert.equal(getContainingLibrary(libs, 49).name, 'third');
    });
    it('should return no library when outside or in holes', function () {
      assert.equal(getContainingLibrary(libs, -1), null);
      assert.equal(getContainingLibrary(libs, -10), null);
      assert.equal(getContainingLibrary(libs, 100), null);
      assert.equal(getContainingLibrary(libs, 256), null);
      assert.equal(getContainingLibrary(libs, 50), null);
      assert.equal(getContainingLibrary(libs, 55), null);
      assert.equal(getContainingLibrary(libs, 59), null);
    });
  });

  describe('symbolicateProfile', function (done) {
    let unsymbolicatedProfile = null;
    let symbolicatedProfile = null;

    before(function () {
      unsymbolicatedProfile = preprocessProfile(exampleProfile);
      const symbolTable = {
        0: 'first symbol',
        0xf00: 'second symbol',
        0x1a00: 'third symbol',
        0x2000: 'last symbol',
      };
      const symbolProvider = new FakeSymbolStore({ 'firefox': symbolTable, 'firefox-webcontent': symbolTable });
      symbolicatedProfile = Object.assign({}, unsymbolicatedProfile, { threads: unsymbolicatedProfile.threads.slice() });
      const symbolicationPromise = symbolicateProfile(unsymbolicatedProfile, symbolProvider, {
        onMergeFunctions: (threadIndex, oldFuncToNewFuncMap) => {
          symbolicatedProfile.threads[threadIndex] = applyFunctionMerging(symbolicatedProfile.threads[threadIndex], oldFuncToNewFuncMap);
        },
        onGotFuncNames: (threadIndex, funcIndices, funcNames) => {
          symbolicatedProfile.threads[threadIndex] = setFuncNames(symbolicatedProfile.threads[threadIndex], funcIndices, funcNames);
        },
      });
      return symbolicationPromise;
    });

    it('should assign correct symbols to frames', function () {
      function functionNameForFrameInThread(thread, frameIndex) {
        const funcIndex = thread.frameTable.func[frameIndex];
        const funcNameStringIndex = thread.funcTable.name[funcIndex];
        return thread.stringTable.getString(funcNameStringIndex);
      }
      assert.equal(functionNameForFrameInThread(unsymbolicatedProfile.threads[0], 1), '0x100000f84');
      assert.equal(functionNameForFrameInThread(symbolicatedProfile.threads[0], 1), 'second symbol');
      assert.equal(functionNameForFrameInThread(unsymbolicatedProfile.threads[0], 2), '0x100001a45');
      assert.equal(functionNameForFrameInThread(symbolicatedProfile.threads[0], 2), 'third symbol');
    });
  });
  // TODO: check that functions are collapsed correctly
});

describe('upgrades', function () {
  describe('old-cleopatra-profile', function () {
    const exampleOldCleopatraProfile = require('./upgrades/old-cleopatra-profile.sps.json');
    it('should detect the profile as an old cleopatra profile', function () {
      assert.isTrue(isOldCleopatraFormat(exampleOldCleopatraProfile));
    });
    it('should be able to convert the old cleopatra profile into a preprocessed profile', function () {
      const profile = convertOldCleopatraProfile(exampleOldCleopatraProfile);
      assert.isTrue(isPreprocessedProfile(profile));
      // For now, just test that upgrading doesn't throw any exceptions.
      upgradePreprocessedProfileToCurrentVersion(profile);
    });
  });
  function comparePreprocessedProfiles(lhs, rhs) {
    // Preprocessed profiles contain a stringTable which isn't easily comparable.
    // Instead, serialize the profiles first, so that the stringTable becomes a
    // stringArray, and compare the serialized versions.
    const serializedLhsAsObject = JSON.parse(serializeProfile(lhs));
    const serializedRhsAsObject = JSON.parse(serializeProfile(rhs));

    // Don't compare the version of the raw profile that these profiles originated from.
    delete serializedLhsAsObject.meta.version;
    delete serializedRhsAsObject.meta.version;

    assert.deepEqual(serializedLhsAsObject, serializedRhsAsObject);
  }
  const currentProfile = preprocessProfile(exampleProfile);
  it('should import an old profile and upgrade it to be the same as the current exampleProfile', function () {
    const serializedOldPreprocessedProfile0 = require('./upgrades/prepr-0.sps.json');
    const upgradedProfile0 = unserializeProfileOfArbitraryFormat(serializedOldPreprocessedProfile0);
    comparePreprocessedProfiles(upgradedProfile0, currentProfile);
    const serializedOldPreprocessedProfile1 = require('./upgrades/prepr-1.sps.json');
    const upgradedProfile1 = unserializeProfileOfArbitraryFormat(serializedOldPreprocessedProfile1);
    comparePreprocessedProfiles(upgradedProfile1, currentProfile);
    const rawProfile3 = require('./upgrades/raw-3.sps.json');
    const upgradedRawProfile3 = unserializeProfileOfArbitraryFormat(rawProfile3);
    comparePreprocessedProfiles(upgradedRawProfile3, currentProfile);
    // const serializedOldPreprocessedProfile2 = require('./upgrades/prepr-2.sps.json');
    // const upgradedProfile2 = unserializeProfileOfArbitraryFormat(serializedOldPreprocessedProfile2);
    // comparePreprocessedProfiles(upgradedProfile2, currentProfile);
    // const rawProfile4 = require('./upgrades/raw-4.sps.json');
    // const upgradedRawProfile4 = unserializeProfileOfArbitraryFormat(rawProfile4);
    // comparePreprocessedProfiles(upgradedRawProfile4, currentProfile);
  });
  it('should import an old raw profile and upgrade it to be the same as the current exampleProfile', function () {
    // This is not working. We have JSON strings in the profile, so it tries to
    // compare those strings, but objects inside them have different property
    // orders.

    // const rawProfile3 = require('./upgrades/raw-3.sps.json');
    // upgradeRawProfileToCurrentVersion(rawProfile3);
    // assert.deepEqual(rawProfile3, exampleProfile);
    // const rawProfile4 = require('./upgrades/raw-4.sps.json');
    // upgradeRawProfileToCurrentVersion(rawProfile4);
    // assert.deepEqual(upgradedProfile4, exampleProfile);
  });
});

describe('color-categories', function () {
  const profile = preprocessProfile(exampleProfile);
  const [thread] = profile.threads;
  it('calculates the category for each frame', function () {
    const categories = thread.samples.stack.map(stackIndex => {
      return getCategoryByImplementation(thread, thread.stackTable.frame[stackIndex]);
    });
    for (let i = 0; i < 6; i++) {
      assert.equal(categories[i].name, 'Platform',
        'The platform frames are labeled platform');
      assert.equal(categories[i].color, implementationCategoryMap.Platform,
        'The platform frames are colored according to the color definition');
    }
    assert.equal(categories[6].name, 'JS Baseline',
      'The JS Baseline frame is labeled as as JS Baseline.');
    assert.equal(categories[6].color, implementationCategoryMap['JS Baseline'],
      'The platform frames are colored according to the color definition');
  });
});
