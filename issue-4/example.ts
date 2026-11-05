/* MD
  ## 🐞 Viewpoint: go() applies neither field_of_view nor view_to_world_scale
  ---
  `Viewpoint.go()` sets the projection, the position and the target, but not the lens: a perspective viewpoint is shown with whatever field of view the camera had, an orthographic one with whatever zoom. `updateCamera()` also stores the orthographic height without the zoom.

  This example restores two buildingSMART BCF 3.0 test cases, a 35.98° perspective one and an 18.97 m orthographic one: on the left as BCF means them, on the right with `BCFTopics.load` + `go()`.
*/

import * as THREE from "three";
import Stats from "stats.js";
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import JSZip from "jszip";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

/* MD
  ### 🌎 Setting up two worlds
  Both worlds belong to the same components and show the same model, each in its own container. The left one shows what BCF means; the right one is driven by That Open:
*/

const components = new OBC.Components();
const worlds = components.get(OBC.Worlds);

const createWorld = (containerId: string) => {
  const world = worlds.create<
    OBC.SimpleScene,
    OBC.OrthoPerspectiveCamera,
    OBF.PostproductionRenderer
  >();
  world.scene = new OBC.SimpleScene(components);
  world.scene.setup();
  world.scene.three.background = new THREE.Color("#e9edf1");
  const container = document.getElementById(containerId)!;
  world.renderer = new OBF.PostproductionRenderer(components, container);
  world.camera = new OBC.OrthoPerspectiveCamera(components);
  return world;
};

const expectedWorld = createWorld("expected");
const thatOpenWorld = createWorld("thatopen");

components.init();

/* MD
  ### 🛠️ Setting Up Fragments
  Each world gets its own copy of the model, so both show it with their own camera:
*/

const workerUrl = await OBC.FragmentsManager.getWorker();
const fragments = components.get(OBC.FragmentsManager);
fragments.init(workerUrl);

const worldsByModel = new Map([
  ["expected", expectedWorld],
  ["thatopen", thatOpenWorld],
]);

for (const world of worldsByModel.values()) {
  world.camera.controls.addEventListener("update", () =>
    fragments.core.update(),
  );
}

fragments.list.onItemSet.add(({ value: model }) => {
  const world = worldsByModel.get(model.modelId)!;
  model.useCamera(world.camera.three);
  world.scene.three.add(model.object);
  fragments.core.update(true);
});

/* MD
  ### 📂 Loading the test model
  The BCF 3.0 test cases of buildingSMART point at the elements of their `Architectural.ifc`. It is converted to Fragments once, and the result is loaded twice:
*/

const testCases =
  "https://raw.githubusercontent.com/buildingSMART/BCF-XML/release_3_0/Test%20Cases";

const ifcLoader = components.get(OBC.IfcLoader);
await ifcLoader.setup({
  autoSetWasm: false,
  wasm: { path: "https://unpkg.com/web-ifc@0.0.77/", absolute: true },
});

const ifcFile = await fetch(`${testCases}/IFCs/Architectural.ifc`);
const ifcData = new Uint8Array(await ifcFile.arrayBuffer());
const expectedModel = await ifcLoader.load(ifcData, true, "expected");
const fragmentsBuffer = await expectedModel.getBuffer(false);
await fragments.core.load(fragmentsBuffer, { modelId: "thatopen" });

/* MD
  ### 📐 Where BCF puts things
  BCF gives points in the model's IFC coordinates, Z up. The world is Y up, and That Open places the models by the base coordination matrix of the first one. So a BCF point in the world is `(x, z, −y)` moved by that matrix, and a direction is turned by it:
*/

const baseMatrix = fragments.baseCoordinationMatrix;

type BcfVector = { x: number; y: number; z: number };

const getWorldPoint = ({ x, y, z }: BcfVector) =>
  new THREE.Vector3(x, z, -y).applyMatrix4(baseMatrix);

const getWorldDirection = ({ x, y, z }: BcfVector) =>
  new THREE.Vector3(x, z, -y).transformDirection(baseMatrix);

/* MD
  ### 🧭 Showing the IFC axes
  To read the views, both worlds show the IFC axes at the IFC origin: X, Y (north) and Z (up):
*/

const createLabel = (text: string, color: string) => {
  const element = document.createElement("div");
  element.className = "scene-label";
  element.style.color = color;
  element.textContent = text;
  return new CSS2DObject(element);
};

const ifcAxes = [
  { text: "IFC X", axis: { x: 1, y: 0, z: 0 }, color: "#d62728" },
  { text: "IFC Y (north)", axis: { x: 0, y: 1, z: 0 }, color: "#2ca02c" },
  { text: "IFC Z (up)", axis: { x: 0, y: 0, z: 1 }, color: "#1f77b4" },
];

for (const world of worldsByModel.values()) {
  const origin = getWorldPoint({ x: 0, y: 0, z: 0 });
  for (const { text, axis, color } of ifcAxes) {
    const direction = getWorldDirection(axis);
    world.scene.three.add(
      new THREE.ArrowHelper(direction, origin, 4, color, 0.5, 0.25),
    );
    const label = createLabel(text, color);
    label.position.copy(origin).addScaledVector(direction, 4.4);
    world.scene.three.add(label);
  }
}

/* MD
  With the same conversion, the left world's camera is put exactly where a BCF camera is, its up vector and its lens included:
*/

const setExpectedCamera = async (
  camera: OBC.ViewpointPerspectiveCamera | OBC.ViewpointOrthogonalCamera,
) => {
  const { controls, projection, threePersp, threeOrtho } = expectedWorld.camera;
  const isPerspective = "field_of_view" in camera;
  await projection.set(isPerspective ? "Perspective" : "Orthographic");
  if (isPerspective) {
    threePersp.fov = camera.field_of_view;
    threePersp.updateProjectionMatrix();
  }
  controls.camera.up.copy(getWorldDirection(camera.camera_up_vector));
  controls.updateCameraUp();
  const position = getWorldPoint(camera.camera_view_point);
  const target = position
    .clone()
    .add(getWorldDirection(camera.camera_direction));
  await controls.setLookAt(...position.toArray(), ...target.toArray(), false);
  if (!isPerspective) {
    await controls.zoomTo(
      (threeOrtho.top - threeOrtho.bottom) / camera.view_to_world_scale,
      false,
    );
  }
  controls.update(0);
  await fragments.core.update(true);
};

/* MD
  ### 📄 The test cases
  Each `.bcf` file holds the viewpoint and its snapshot, which shows what the viewpoint should look like:
*/

const testCasePaths = {
  perspective:
    "all%20components%20and%20spaces%20visible/all%20components%20and%20spaces%20visible.bcf",
  orthographic: "Component%20selection/component%20selection.bcf",
};

const loadTestCase = async (path: string) => {
  const file = await fetch(`${testCases}/v3.0/Visualization/${path}`);
  const data = new Uint8Array(await file.arrayBuffer());
  const zip = await JSZip.loadAsync(data);
  const files = Object.values(zip.files);
  const viewpointXml = await files
    .find((item) => item.name.endsWith(".bcfv"))!
    .async("string");
  const snapshot = await files
    .find((item) => item.name.endsWith(".png"))!
    .async("blob");

  const xml = new DOMParser().parseFromString(viewpointXml, "application/xml");
  const readVector = (tag: string): BcfVector => {
    const element = xml.querySelector(tag)!;
    const read = (axis: string) =>
      Number(element.querySelector(axis)!.textContent);
    return { x: read("X"), y: read("Y"), z: read("Z") };
  };
  const readNumber = (tag: string) =>
    Number(xml.querySelector(tag)?.textContent);
  const camera = {
    camera_view_point: readVector("CameraViewPoint"),
    camera_direction: readVector("CameraDirection"),
    camera_up_vector: readVector("CameraUpVector"),
    aspect_ratio: readNumber("AspectRatio"),
  };
  const lens = xml.querySelector("FieldOfView")
    ? { field_of_view: readNumber("FieldOfView") }
    : { view_to_world_scale: readNumber("ViewToWorldScale") };

  return {
    data,
    snapshotUrl: URL.createObjectURL(snapshot),
    camera: { ...camera, ...lens } as
      | OBC.ViewpointPerspectiveCamera
      | OBC.ViewpointOrthogonalCamera,
  };
};

/* MD
  ### ✨ Restoring a test case
  On the left the camera is put where BCF means it. On the right That Open imports the file and goes to its viewpoint, starting from the default lens:
*/

const bcfTopics = components.get(OBC.BCFTopics);
let snapshotUrl = "";

const restoreTestCase = async (path: string) => {
  const testCase = await loadTestCase(path);
  snapshotUrl = testCase.snapshotUrl;
  await setExpectedCamera(testCase.camera);

  const { controls, threePersp, threeOrtho } = thatOpenWorld.camera;
  threePersp.fov = 60;
  threePersp.updateProjectionMatrix();
  await controls.zoomTo(1, false);
  const { viewpoints } = await bcfTopics.load(testCase.data);
  const [viewpoint] = viewpoints;
  viewpoint.world = thatOpenWorld;
  await viewpoint.go({ transition: false });
  controls.update(0);
  await fragments.core.update(true);

  if ("field_of_view" in testCase.camera) {
    report("go() field of view", threePersp.fov, testCase.camera.field_of_view);
  } else {
    const visibleHeight =
      (threeOrtho.top - threeOrtho.bottom) / threeOrtho.zoom;
    report(
      "go() orthographic visible height",
      visibleHeight,
      testCase.camera.view_to_world_scale,
    );

    // The right view zoomed by hand to the file's height, then captured by That Open
    await controls.zoomTo(
      (threeOrtho.top - threeOrtho.bottom) /
        testCase.camera.view_to_world_scale,
      false,
    );
    controls.update(0);
    const captured = components.get(OBC.Viewpoints).create();
    captured.world = thatOpenWorld;
    await captured.updateCamera(false);
    const scale = (captured.camera as OBC.ViewpointOrthogonalCamera)
      .view_to_world_scale;
    report(
      "updateCamera() view_to_world_scale",
      scale,
      testCase.camera.view_to_world_scale,
    );
    await controls.zoomTo(1, false);
    controls.update(0);
  }
};

const restorePerspective = () => restoreTestCase(testCasePaths.perspective);
const restoreOrthographic = () => restoreTestCase(testCasePaths.orthographic);

/* MD
  ### 🧪 Checking in numbers
  Each step also reports what it got next to what BCF (or the API's own docs) expects, in the panel and in the console:
*/

const results: string[] = [];

const report = (label: string, actual: unknown, expected: unknown) => {
  const format = (value: unknown) =>
    JSON.stringify(value, (_, item) =>
      typeof item === "number" ? +item.toFixed(3) : item,
    );
  const isOk = format(actual) === format(expected);
  const line = `${isOk ? "OK" : "BUG"} ${label}: got ${format(actual)}, expected ${format(expected)}`;
  console.log(line);
  results.push(line);
  updatePanel();
};

/* MD
  ### 🧩 Adding some UI
  We will use the `@thatopen/ui` library to add the buttons, the test case's snapshot and the results:
*/

BUI.Manager.init();

const [panel, updatePanel] = BUI.Component.create<BUI.PanelSection, {}>(
  (_) => BUI.html`
    <bim-panel active label="4. go() keeps the lens" class="options-menu">
      <bim-panel-section label="Steps">
        <bim-label style="white-space: normal">Left: as BCF means the test case, as in its snapshot. Right: That Open's go(), with the field of view or zoom it had.</bim-label>
        <bim-button label="Perspective: field of view 35.98°" @click=${restorePerspective}></bim-button>
        <bim-button label="Orthographic: 18.97 m high" @click=${restoreOrthographic}></bim-button>
      </bim-panel-section>
      <bim-panel-section label="Test case snapshot">
        <img src=${snapshotUrl} alt="The test case's snapshot" style="width: 100%">
      </bim-panel-section>
      <bim-panel-section label="Results">
        ${results.map((line) => BUI.html`<bim-label style="white-space: normal">${line}</bim-label>`)}
      </bim-panel-section>
    </bim-panel>
  `,
  {},
);

document.body.append(panel);

/* MD
  And a button that shows or hides the menu on a phone:
*/

const button = BUI.Component.create<BUI.PanelSection>(() => {
  return BUI.html`
      <bim-button class="phone-menu-toggler" icon="solar:settings-bold"
        @click="${() => {
          if (panel.classList.contains("options-menu-visible")) {
            panel.classList.remove("options-menu-visible");
          } else {
            panel.classList.add("options-menu-visible");
          }
        }}">
      </bim-button>
    `;
});

document.body.append(button);

/* MD
  ### ⏱️ Measuring the performance (optional)
*/

const stats = new Stats();
stats.showPanel(2);
document.body.append(stats.dom);
stats.dom.style.left = "0px";
stats.dom.style.zIndex = "unset";
thatOpenWorld.renderer!.onBeforeUpdate.add(() => stats.begin());
thatOpenWorld.renderer!.onAfterUpdate.add(() => stats.end());

await restorePerspective();
