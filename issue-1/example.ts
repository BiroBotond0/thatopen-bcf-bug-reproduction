/* MD
  ## 🐞 Viewpoint JSON: the camera is Y-up
  ---
  `Viewpoint.toJSON()` is documented as BCF-API JSON, and `Viewpoints.create(data)` takes a `BCFViewpoint`. BCF gives the camera in the model's IFC coordinates, Z up. That Open reads and writes it in the world's axes, Y up, while the clipping planes in the same JSON are converted.

  This example restores the camera of buildingSMART's "Perspective camera" BCF 3.0 test case in two worlds: on the left as BCF means it, on the right with `create(data)` + `go()`. Then it saves the right view with `toJSON()` and reads that JSON on the left, as another BCF tool would.
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
  Both worlds belong to the same components and show the same model, each in its own container. The left one is moved by hand to where BCF puts the camera; the right one is driven by That Open's `Viewpoints`:
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
  ### 📐 Where BCF puts the camera
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
  With the same conversion, the left world's camera is put exactly where the BCF camera is, its up vector included:
*/

const setExpectedCamera = async (camera: OBC.ViewpointPerspectiveCamera) => {
  const { controls, threePersp } = expectedWorld.camera;
  threePersp.fov = camera.field_of_view;
  threePersp.updateProjectionMatrix();
  controls.camera.up.copy(getWorldDirection(camera.camera_up_vector));
  controls.updateCameraUp();
  const position = getWorldPoint(camera.camera_view_point);
  const target = position
    .clone()
    .add(getWorldDirection(camera.camera_direction));
  await controls.setLookAt(...position.toArray(), ...target.toArray(), false);
  controls.update(0);
  await fragments.core.update(true);
};

/* MD
  ### 📄 The test case
  The `.bcf` file holds the viewpoint and its snapshot, which shows what the viewpoint should look like:
*/

const testCaseFile = await fetch(
  `${testCases}/v3.0/Visualization/Perspective%20camera/perspective%20camera.bcf`,
);
const zip = await JSZip.loadAsync(await testCaseFile.arrayBuffer());
const files = Object.values(zip.files);
const viewpointXml = await files
  .find((file) => file.name.endsWith(".bcfv"))!
  .async("string");
const snapshot = await files
  .find((file) => file.name.endsWith(".png"))!
  .async("blob");
const snapshotUrl = URL.createObjectURL(snapshot);

/* MD
  Its camera, as a BCF-API server returns it:
*/

const xml = new DOMParser().parseFromString(viewpointXml, "application/xml");
const readVector = (tag: string): BcfVector => {
  const element = xml.querySelector(`PerspectiveCamera > ${tag}`)!;
  const read = (axis: string) =>
    Number(element.querySelector(axis)!.textContent);
  return { x: read("X"), y: read("Y"), z: read("Z") };
};

const bcfCamera: OBC.ViewpointPerspectiveCamera = {
  camera_view_point: readVector("CameraViewPoint"),
  camera_direction: readVector("CameraDirection"),
  camera_up_vector: readVector("CameraUpVector"),
  field_of_view: Number(xml.querySelector("FieldOfView")!.textContent),
  aspect_ratio: Number(xml.querySelector("AspectRatio")!.textContent),
};

/* MD
  ### ✨ Restoring the JSON
  On the left the camera is put where BCF means it. On the right the same JSON goes through `Viewpoints.create(data)` and `go()`. `go()` keeps the field of view (issue 4), so it is set by hand here, and only the axes differ:
*/

const viewpoints = components.get(OBC.Viewpoints);
viewpoints.world = thatOpenWorld;

const restoreJson = async () => {
  removeCameraMarkers();
  await setExpectedCamera(bcfCamera);

  const viewpoint = viewpoints.create({ perspective_camera: bcfCamera });
  await viewpoint.go({ transition: false });
  thatOpenWorld.camera.threePersp.fov = bcfCamera.field_of_view;
  thatOpenWorld.camera.threePersp.updateProjectionMatrix();
  await fragments.core.update(true);

  const position = thatOpenWorld.camera.controls.getPosition(
    new THREE.Vector3(),
  );
  report(
    "go() camera height in the world",
    position.y,
    getWorldPoint(bcfCamera.camera_view_point).y,
  );
};

/* MD
  ### 💾 Saving the view
  The other way round: the right world is put on the test case's view, That Open saves it with `updateCamera()` + `toJSON()`, and the left world reads that JSON as BCF:
*/

const captureToJson = async () => {
  removeCameraMarkers();
  await setExpectedCamera(bcfCamera);
  const { controls } = thatOpenWorld.camera;
  const position = getWorldPoint(bcfCamera.camera_view_point);
  const target = position
    .clone()
    .add(getWorldDirection(bcfCamera.camera_direction));
  await controls.setLookAt(...position.toArray(), ...target.toArray(), false);
  controls.update(0);

  const viewpoint = viewpoints.create();
  await viewpoint.updateCamera(false);
  const { perspective_camera } = viewpoint.toJSON();
  await setExpectedCamera(perspective_camera!);

  report(
    "toJSON() camera_view_point.z (height)",
    perspective_camera!.camera_view_point.z,
    bcfCamera.camera_view_point.z,
  );
  report(
    "toJSON() camera_view_point.y",
    perspective_camera!.camera_view_point.y,
    bcfCamera.camera_view_point.y,
  );
};

/* MD
  ### 🔭 Looking at both cameras
  To see where the cameras are, both worlds look at the scene from outside, with the BCF camera in green and That Open's in red. Each is a ball at its position, a long arrow along its view and a short one up:
*/

const cameraMarkers: THREE.Object3D[] = [];

const addCameraMarker = (
  world: OBC.World,
  camera: {
    position: THREE.Vector3;
    direction: THREE.Vector3;
    up: THREE.Vector3;
  },
  text: string,
  color: string,
) => {
  const marker = new THREE.Group();
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.45),
    new THREE.MeshBasicMaterial({ color }),
  );
  ball.position.copy(camera.position);
  marker.add(ball);
  marker.add(
    new THREE.ArrowHelper(
      camera.direction,
      camera.position,
      9,
      color,
      1.5,
      0.75,
    ),
  );
  marker.add(
    new THREE.ArrowHelper(camera.up, camera.position, 3, color, 0.9, 0.45),
  );
  const label = createLabel(text, color);
  label.position.copy(camera.position).y += 1.8;
  marker.add(label);
  world.scene.three.add(marker);
  cameraMarkers.push(marker);
};

const removeCameraMarkers = () => {
  for (const marker of cameraMarkers) {
    marker.traverse((object) => {
      if (object instanceof CSS2DObject) object.element.remove();
    });
    marker.removeFromParent();
  }
  cameraMarkers.length = 0;
};

const showOverview = async () => {
  removeCameraMarkers();
  thatOpenWorld.camera.controls.update(0);
  const thatOpenCamera = thatOpenWorld.camera.three;
  const quaternion = thatOpenCamera.getWorldQuaternion(new THREE.Quaternion());
  const cameras = [
    {
      position: getWorldPoint(bcfCamera.camera_view_point),
      direction: getWorldDirection(bcfCamera.camera_direction),
      up: getWorldDirection(bcfCamera.camera_up_vector),
      text: "BCF camera",
      color: "#2a8a3e",
    },
    {
      position: thatOpenCamera.getWorldPosition(new THREE.Vector3()),
      direction: thatOpenCamera.getWorldDirection(new THREE.Vector3()),
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion),
      text: "That Open camera",
      color: "#c0392b",
    },
  ];

  const box = new THREE.Box3().setFromObject(expectedModel.object);
  for (const camera of cameras) box.expandByPoint(camera.position);
  const center = box.getCenter(new THREE.Vector3());
  const distance = box.getSize(new THREE.Vector3()).length() * 0.8;

  const position = center
    .clone()
    .add(new THREE.Vector3(distance, distance * 0.6, distance));
  const moves = [...worldsByModel.values()].map(async (world) => {
    for (const camera of cameras) {
      addCameraMarker(world, camera, camera.text, camera.color);
    }
    const { controls, threePersp } = world.camera;
    threePersp.fov = 60;
    threePersp.updateProjectionMatrix();
    controls.camera.up.set(0, 1, 0);
    controls.updateCameraUp();
    await controls.setLookAt(...position.toArray(), ...center.toArray(), true);
  });
  await Promise.all(moves);
  await fragments.core.update(true);
};

/* MD
  ### 🧪 Checking in numbers
  Each step also reports what it got next to what BCF expects, in the panel and in the console:
*/

const results: string[] = [];

const report = (label: string, actual: number, expected: number) => {
  const isOk = Math.abs(actual - expected) < 1e-4;
  const line = `${isOk ? "OK" : "BUG"} ${label}: got ${actual.toFixed(3)}, expected ${expected.toFixed(3)}`;
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
    <bim-panel active label="1. Viewpoint JSON camera is Y-up" class="options-menu">
      <bim-panel-section label="Steps">
        <bim-label style="white-space: normal">Left: the viewpoint where BCF puts it. Right: That Open with the same data.</bim-label>
        <bim-button label="Restore the test case's JSON" @click=${restoreJson}></bim-button>
        <bim-button label="Save the right view, read it on the left" @click=${captureToJson}></bim-button>
        <bim-button label="Overview of both cameras" @click=${showOverview}></bim-button>
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

await restoreJson();
