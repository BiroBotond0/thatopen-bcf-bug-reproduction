/* MD
  ## 🐞 Viewpoint / BCFTopics: BCF clipping planes are dropped, and clip the wrong half
  ---
  `Viewpoint.set()` creates clipping planes only when the viewpoint already has a world. `Viewpoints.create(data)` gives it the world after `set()`, and `BCFTopics.load` gives it none, so their planes are dropped. When a plane is made, BCF's direction (which points into the clipped half, as the `Viewpoint` docs also say) becomes the Clipper's normal, whose half the Clipper keeps: the wrong half is cut off. `load` also reads `Location.x` where the file has `X`, and `set()` clears the title.

  buildingSMART has no BCF 2.1 or 3.0 test case with a clipping plane, so this example makes a BCF 3.0 file with one and imports it: on the left as BCF means it, on the right with That Open.
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
  ### 📄 A BCF file with a clipping plane
  The camera of buildingSMART's "Perspective camera" test case, and a plane through the windows of the building. Its direction is up: what is above the plane is cut off:
*/

const camera: OBC.ViewpointPerspectiveCamera = {
  camera_view_point: {
    x: 17.774198017120362,
    y: -28.595696754455595,
    z: 8.034313440322876,
  },
  camera_direction: {
    x: -0.43062978982925415,
    y: 0.8994858264923096,
    z: -0.07404891401529312,
  },
  camera_up_vector: {
    x: -0.03197544813156128,
    y: 0.06678930670022964,
    z: 0.9972546100616455,
  },
  aspect_ratio: 1.7777777777777777,
  field_of_view: 29.39495760413827,
};

const clippingPlane = {
  location: { x: 6, y: -6, z: 7.5 },
  direction: { x: 0, y: 0, z: 1 },
};

const toXml = (tag: string, { x, y, z }: BcfVector) =>
  `<${tag}><X>${x}</X><Y>${y}</Y><Z>${z}</Z></${tag}>`;

const viewpointXml = `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="1d6b3c2e-5f4a-4e8b-9c7d-2a1b0c9d8e7f">
  <ClippingPlanes>
    <ClippingPlane>${toXml("Location", clippingPlane.location)}${toXml("Direction", clippingPlane.direction)}</ClippingPlane>
  </ClippingPlanes>
  <PerspectiveCamera>
    ${toXml("CameraViewPoint", camera.camera_view_point)}
    ${toXml("CameraDirection", camera.camera_direction)}
    ${toXml("CameraUpVector", camera.camera_up_vector)}
    <AspectRatio>${camera.aspect_ratio}</AspectRatio>
    <FieldOfView>${camera.field_of_view}</FieldOfView>
  </PerspectiveCamera>
</VisualizationInfo>`;

const zip = new JSZip();
zip.file(
  "bcf.version",
  `<?xml version="1.0" encoding="UTF-8"?><Version VersionId="3.0" />`,
);
zip.file("a7f3d5c1-2b4e-4c6f-9a8d-1e2f3a4b5c6d/viewpoint.bcfv", viewpointXml);
const bcfData = await zip.generateAsync({ type: "uint8array" });

const downloadFile = () => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([new Uint8Array(bcfData)], { type: "application/zip" }),
  );
  link.download = "clipping-plane.bcfzip";
  link.click();
};

/* MD
  ### ✂️ The plane where BCF puts it
  On the left, the camera and the plane go where BCF puts them. A Clipper plane keeps the half its normal points to, so the normal is the opposite of BCF's direction:
*/

const clipper = components.get(OBC.Clipper);
clipper.enabled = true;

await setExpectedCamera(camera);
const expectedPlane = clipper.createFromNormalAndCoplanarPoint(
  expectedWorld,
  getWorldDirection(clippingPlane.direction).negate(),
  getWorldPoint(clippingPlane.location),
);

const deleteThatOpenPlanes = () => {
  for (const id of [...clipper.list.keys()]) {
    if (id !== expectedPlane) clipper.delete(thatOpenWorld, id);
  }
};

/* MD
  ### 📥 Importing the file
  On the right That Open imports the file and goes to its viewpoint. `go()` keeps the field of view (issue 4), so it is set by hand here. `go()` also switches every Clipper plane that is not the viewpoint's off, so the left plane is switched on again:
*/

const viewpoints = components.get(OBC.Viewpoints);
viewpoints.world = thatOpenWorld;
const bcfTopics = components.get(OBC.BCFTopics);

const importFile = async () => {
  deleteThatOpenPlanes();
  const { viewpoints: imported } = await bcfTopics.load(bcfData);
  const [viewpoint] = imported;
  report("imported viewpoint has a world", viewpoint.world !== null, true);
  report(
    "imported viewpoint's clipping planes",
    viewpoint.clippingPlanes.size,
    1,
  );

  viewpoint.world = thatOpenWorld;
  await viewpoint.go({ transition: false });
  clipper.list.get(expectedPlane)!.enabled = true;
  thatOpenWorld.camera.threePersp.fov = camera.field_of_view;
  thatOpenWorld.camera.threePersp.updateProjectionMatrix();
  await fragments.core.update(true);
};

/* MD
  ### 🔁 The plane made by set()
  Given to `set()` on a viewpoint that already has a world, the plane is made, but the other half is cut off. Its location is moved by the base coordination matrix by hand here (issue 2), so only the direction differs:
*/

const setOnViewpoint = async () => {
  deleteThatOpenPlanes();
  const viewpoint = viewpoints.create();
  const location = getWorldPoint(clippingPlane.location);
  viewpoint.set({
    clipping_planes: [
      {
        location: { x: location.x, y: -location.z, z: location.y },
        direction: clippingPlane.direction,
      },
    ],
  });
  viewpoint.setClippingState(true);
  viewpoint.setClippingVisibility(true);
  clipper.list.get(expectedPlane)!.enabled = true;
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
  In numbers: what `load` reads of the plane, and the title after a `set()` without one:
*/

const checkNumbers = () => {
  const parsed = OBC.BCFTopics.xmlParser.parse(viewpointXml).VisualizationInfo;
  const { Location } = parsed.ClippingPlanes.ClippingPlane;
  report("Location.x, what load() reads", Location.x, 6);

  const titled = viewpoints.create({ title: "Level 2" });
  titled.set({
    components: {
      selection: [],
      coloring: [],
      visibility: {
        default_visibility: true,
        exceptions: [],
        view_setup_hints: {
          spaces_visible: false,
          space_boundaries_visible: false,
          openings_visible: false,
        },
      },
    },
  });
  report("title after set() without a title", titled.title ?? null, "Level 2");
};

/* MD
  ### 🧩 Adding some UI
  We will use the `@thatopen/ui` library to add the buttons and the results:
*/

BUI.Manager.init();

const [panel, updatePanel] = BUI.Component.create<BUI.PanelSection, {}>(
  (_) => BUI.html`
    <bim-panel active label="7. Clipping planes dropped and inverted" class="options-menu">
      <bim-panel-section label="Steps">
        <bim-label style="white-space: normal">One clipping plane at IFC Z = 7.5 m, cutting off what is above it. Left: as BCF means it. Right: That Open.</bim-label>
        <bim-button label="Import the file (BCFTopics.load)" @click=${importFile}></bim-button>
        <bim-button label="set() on a viewpoint with a world" @click=${setOnViewpoint}></bim-button>
        <bim-button label="Download the .bcfzip" @click=${downloadFile}></bim-button>
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

await importFile();
checkNumbers();
