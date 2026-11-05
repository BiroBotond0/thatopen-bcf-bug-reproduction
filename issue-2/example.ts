/* MD
  ## 🐞 Viewpoint: clipping planes ignore the base coordination matrix
  ---
  That Open stores the viewpoint camera relative to the base coordination matrix, the first model's coordination matrix: the camera position goes through it. The clipping planes do not: `Viewpoint.set()` creates them at the stored location, and `toJSON()` writes the plane's world position. For an IFC model the matrix is a translation (here, `Architectural.ifc`'s), so the planes land in the wrong place. The `position` setter drops the matrix too.

  This example gives the same BCF clipping plane, through the windows of the building, to both worlds.
*/

import * as THREE from "three";
import Stats from "stats.js";
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
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
  ### ✂️ The clipping plane
  A BCF clipping plane through the windows of `Architectural.ifc` (its ground floor is at IFC Z ≈ 5.75 m). BCF's direction points into the clipped half: up, so what is above the plane is cut off:
*/

const clippingPlane = {
  location: { x: 6, y: -6, z: 7.5 },
  direction: { x: 0, y: 0, z: 1 },
};

/* MD
  On the right, That Open makes it. `set()` creates planes only when the viewpoint already has a world, which `create(data)` gives it too late (issue 7), so the viewpoint is created first and `set()` is called on it. That Open also takes the direction as the side to keep (issue 7), so it is reversed here, and only the position differs:
*/

const viewpoints = components.get(OBC.Viewpoints);
viewpoints.world = thatOpenWorld;

const viewpoint = viewpoints.create();
const { direction } = clippingPlane;
viewpoint.set({
  clipping_planes: [
    {
      location: clippingPlane.location,
      direction: { x: -direction.x, y: -direction.y, z: -direction.z },
    },
  ],
});
viewpoint.setClippingState(true);
viewpoint.setClippingVisibility(true);

/* MD
  On the left, the plane goes where BCF puts it. A Clipper plane keeps the half its normal points to, so the normal is the opposite of BCF's direction:
*/

const clipper = components.get(OBC.Clipper);
clipper.enabled = true;
clipper.createFromNormalAndCoplanarPoint(
  expectedWorld,
  getWorldDirection(clippingPlane.direction).negate(),
  getWorldPoint(clippingPlane.location),
);

/* MD
  Both worlds look at the building from the same place, between the two planes:
*/

const thatOpenPlanePoint = new THREE.Vector3(6, 7.5, 6);
const box = new THREE.Box3()
  .setFromObject(expectedModel.object)
  .expandByPoint(getWorldPoint(clippingPlane.location))
  .expandByPoint(thatOpenPlanePoint);
const center = box.getCenter(new THREE.Vector3());
const size = box.getSize(new THREE.Vector3()).length();
for (const world of worldsByModel.values()) {
  const position = center
    .clone()
    .add(new THREE.Vector3(size * 0.6, 0, size * 0.6));
  position.y = 6;
  await world.camera.controls.setLookAt(
    ...position.toArray(),
    ...center.toArray(),
    false,
  );
}
await fragments.core.update(true);

/* MD
  A button turns the clipping off and on, to compare with the uncut building:
*/

let isClipped = true;
const toggleClipping = async () => {
  isClipped = !isClipped;
  for (const plane of clipper.list.values()) plane.enabled = isClipped;
  await fragments.core.update(true);
};

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
  In numbers: That Open's plane should be where BCF puts it in the world, and a position given to the `position` setter should be read back as it was given:
*/

const checkNumbers = () => {
  const [planeId] = viewpoint.clippingPlanes;
  const origin = clipper.list.get(planeId)!.origin;
  report(
    "set() plane origin in the world",
    origin.toArray(),
    getWorldPoint(clippingPlane.location).toArray(),
  );

  const moved = viewpoints.create();
  const position = new THREE.Vector3(5, 5, 5);
  moved.position = position;
  report(
    "position after position = (5, 5, 5)",
    moved.position.toArray(),
    position.toArray(),
  );
};

/* MD
  ### 🧩 Adding some UI
  We will use the `@thatopen/ui` library to add the buttons and the results:
*/

BUI.Manager.init();

const [panel, updatePanel] = BUI.Component.create<BUI.PanelSection, {}>(
  (_) => BUI.html`
    <bim-panel active label="2. Clipping planes ignore the coordination matrix" class="options-menu">
      <bim-panel-section label="Steps">
        <bim-label style="white-space: normal">The same BCF clipping plane at IFC Z = 7.5 m. Left: where BCF puts it, through the windows. Right: where That Open puts it.</bim-label>
        <bim-button label="Clipping on / off" @click=${toggleClipping}></bim-button>
        <bim-button label="Check in numbers" @click=${checkNumbers}></bim-button>
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

checkNumbers();
