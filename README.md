# That Open 3.6.0: BCF viewpoint and Marker repros

Minimal reproductions for bugs in `@thatopen/components` / `@thatopen/components-front` 3.6.0, installed from npm. Each one is written like That Open's own examples: one `issue-<n>/example.ts` with its `example.html`, explained in `/* MD */` blocks, with a `@thatopen/ui` panel.

```bash
npm install
npm run dev
```

Open the printed URL and pick an issue. The examples show the same scene in two worlds:

- **Expected (BCF)**, on the left: what the viewpoint means by the BCF specification. Each example converts BCF's Z-up IFC coordinates to the Y-up world itself, moved by the base coordination matrix as That Open places the models (section "📐 Where BCF puts things").
- **That Open 3.6.0**, on the right: the same data through That Open's API (`Viewpoints.create` / `BCFTopics.load` + `Viewpoint.go`, `updateCamera`, `toJSON`, `Marker`).

Where a buildingSMART BCF 3.0 test case is used, its snapshot is in the panel, and the model is its `Architectural.ifc`, both fetched from [buildingSMART/BCF-XML](https://github.com/buildingSMART/BCF-XML/tree/release_3_0/Test%20Cases). The Marker example uses That Open's `school_arq.frag`. The panel's **Results** show the same bugs in numbers (also in the console). `screenshots/` has a picture of each example.

| Example | Bug |
| --- | --- |
| `issue-1` | `Viewpoint.toJSON()` / `create(data)` use a Y-up camera |
| `issue-2` | Clipping planes and the position setter ignore the base coordination matrix |
| `issue-3` | The camera up vector is lost on capture, export and import |
| `issue-4` | `go()` applies neither `field_of_view` nor `view_to_world_scale` |
| `issue-5` | The `updateCamera(true)` snapshot has no postproduction |
| `issue-6` | `Marker.delete()` leaves the cluster label on screen; `cluster(world)` clears the other worlds' groups |
| `issue-7` | Clipping planes are dropped by `create(data)` / `load()`, and clip the wrong half |

To show one bug per example, an example sets by hand what another bug would change (for example the field of view after `go()` in issue 1); the text next to it names the other issue.
