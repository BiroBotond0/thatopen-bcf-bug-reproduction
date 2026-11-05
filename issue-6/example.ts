/* MD
  ## 🐞 Marker: delete() leaves the cluster label on screen
  ---
  The Marker groups markers close to each other on the screen into one label with their count. `Marker.delete()` disposes the marker, but not the group that holds it: the group's label stays on screen, with its old count, until the camera next comes to rest.

  This example puts two pins next to each other in both worlds, then deletes them. On the left `cluster()` is called by hand after the deletes, which is what `delete()` should leave.
*/

import * as THREE from "three";
import Stats from "stats.js";
import * as BUI from "@thatopen/ui";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

/* MD
  ### 🌎 Setting up two worlds
  Each world has its own components here, so each has its own Marker: one Marker clusters all its worlds together, and `cluster()` on one world throws away the groups of the other (see the issue):
*/

const createWorld = async (containerId: string) => {
  const components = new OBC.Components();
  const world = components
    .get(OBC.Worlds)
    .create<
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
  components.init();

  // Each world loads the school model of That Open's tutorials into its own FragmentsManager

  const workerUrl = await OBC.FragmentsManager.getWorker();
  const fragments = components.get(OBC.FragmentsManager);
  fragments.init(workerUrl);
  world.camera.controls.addEventListener("update", () =>
    fragments.core.update(),
  );
  fragments.list.onItemSet.add(({ value: model }) => {
    model.useCamera(world.camera.three);
    world.scene.three.add(model.object);
    fragments.core.update(true);
  });

  const fragFile = await fetch(
    "https://thatopen.github.io/engine_components/resources/frags/school_arq.frag",
  );
  const model = await fragments.core.load(await fragFile.arrayBuffer(), {
    modelId: "school",
  });
  await fragments.core.update(true);

  return { world, marker: components.get(OBF.Marker), model, fragments };
};

const expected = await createWorld("expected");
const thatOpen = await createWorld("thatopen");
const thatOpenWorld = thatOpen.world;

/* MD
  ### 📍 Two pins
  Two pins 1 m apart on the roof, which the Marker groups into one "2". Both worlds look at them from the same place:
*/

const createPin = (text: string) => {
  const element = document.createElement("div");
  element.textContent = text;
  element.style.cssText =
    "padding: 2px 8px; border-radius: 10px; background: #1f77b4; color: #fff; font: 600 13px sans-serif";
  return element;
};

const modelBox = new THREE.Box3().setFromObject(expected.model.object);
const pinPoint = new THREE.Vector3(
  (modelBox.min.x + modelBox.max.x) / 2,
  modelBox.max.y,
  (modelBox.min.z + modelBox.max.z) / 2,
);

let pins: string[][] = [];

const addPins = () => {
  pins = [expected, thatOpen].map(({ world, marker }) => {
    const keys = [
      marker.create(world, createPin("A"), pinPoint)!,
      marker.create(
        world,
        createPin("B"),
        pinPoint.clone().add(new THREE.Vector3(1, 0, 0)),
      )!,
    ];
    marker.cluster(world);
    return keys;
  });
};

for (const { world, fragments } of [expected, thatOpen]) {
  const position = pinPoint.clone().add(new THREE.Vector3(30, 25, 30));
  await world.camera.controls.setLookAt(
    ...position.toArray(),
    ...pinPoint.toArray(),
    false,
  );
  world.camera.controls.update(0);
  await fragments.core.update(true);
}
addPins();

/* MD
  ### 🗑️ Deleting the pins
  Both pins are deleted with `Marker.delete()` in both worlds. On the left `cluster()` follows, so the left world shows what `delete()` should leave:
*/

const deletePins = () => {
  for (const [index, { marker }] of [expected, thatOpen].entries()) {
    for (const key of pins[index] ?? []) marker.delete(key);
  }
  pins = [];
  expected.marker.cluster(expected.world);

  // The labels the Marker keeps in the right world's scene, rendered or not
  const labels = thatOpenWorld.scene.three.children.filter(
    (child) => child instanceof CSS2DObject,
  );
  report(
    "labels left on the right after deleting both pins",
    labels.map((label) => (label as CSS2DObject).element.textContent),
    [],
  );
};

const addPinsAgain = () => {
  if (pins.length) return;
  addPins();
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
  ### 🧩 Adding some UI
  We will use the `@thatopen/ui` library to add the buttons and the results:
*/

BUI.Manager.init();

const [panel, updatePanel] = BUI.Component.create<BUI.PanelSection, {}>(
  (_) => BUI.html`
    <bim-panel active label="6. Marker.delete() leaves the group" class="options-menu">
      <bim-panel-section label="Steps">
        <bim-label style="white-space: normal">Two pins grouped into a 2. Delete them: right, the 2 stays; left, cluster() after the deletes.</bim-label>
        <bim-button label="Delete both pins" @click=${deletePins}></bim-button>
        <bim-button label="Add the pins again" @click=${addPinsAgain}></bim-button>
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
