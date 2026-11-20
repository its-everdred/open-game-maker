# Stone A12 rebuild

Round 105 rebuilds Stone A12 as one locally rendered model for all four views.
The experiment, source-derived inputs, comparison image, scores and reproducible
recipe are stored in `assets-local/experiments/sprite-pipeline/stone-a12/candidate-105/`.
The original pack remains read-only. The local manifest records inherited usage
rights and identifies the output as AI-assisted.

The model starts from the carved four-view hull, smooths it, and assigns the
smaller tan and gray stones their own face colors and shades without added
surface noise. One gray pebble
region uses a continuous shaded material to remove isolated color patches. Two
additional light bands shade the top of the main boulder. A shared light
casts shadows for every view. The recipe renders eight samples per view and
finishes each image with shadow alpha 165; it writes only inside the experiment
directory and refuses to overwrite an existing output directory.

| View | Silhouette IoU | Pixel similarity | Palette distance | Edge F1 | Luminance L1 | Shadow IoU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| N | 0.9647 | 0.9625 | 1.0792 | 0.9768 | 0.1349 | 0.6509 |
| E | 0.9578 | 0.9625 | 0.8476 | 0.9609 | 0.1356 | 0.6034 |
| S | 0.9594 | 0.9698 | 0.9347 | 0.9765 | 0.1700 | 0.6262 |
| W | 0.9685 | 0.9733 | 1.0195 | 0.9883 | 0.1528 | 0.7585 |

All measured values pass the prop gates in each view. The 3D comparison is
awaiting a two-track review sheet. The requested flat image
option cannot use the original as a cloud reference under the local-only pack
rule. No creator verdict has been received for this candidate.
