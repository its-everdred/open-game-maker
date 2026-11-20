# Stone A12 rebuild

Round 97 rebuilds Stone A12 as one locally rendered model for all four views.
The experiment, source-derived inputs, comparison image, scores and reproducible
recipe are stored in `assets-local/experiments/sprite-pipeline/stone-a12/candidate-97/`.
The original pack remains read-only. The local manifest records inherited usage
rights and identifies the output as AI-assisted.

The model starts from the carved four-view hull, smooths it, and assigns the
smaller tan and gray stones their own face colors and shades. A shared light
casts shadows for every view. The recipe renders eight samples per view and
finishes each image with shadow alpha 165; it writes only inside the experiment
directory and refuses to overwrite an existing output directory.

| View | Silhouette IoU | Pixel similarity | Palette distance | Edge F1 | Luminance L1 | Shadow IoU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| N | 0.9647 | 0.9657 | 1.0086 | 0.9768 | 0.1190 | 0.6509 |
| E | 0.9578 | 0.9628 | 0.8618 | 0.9609 | 0.1516 | 0.6034 |
| S | 0.9594 | 0.9700 | 1.1042 | 0.9765 | 0.1943 | 0.6262 |
| W | 0.9685 | 0.9744 | 0.9025 | 0.9883 | 0.1651 | 0.7585 |

All measured values pass the prop gates in each view. A separate run of
`candidate-97/rebuild.sh` reproduced all four images byte-for-byte and produced
the same scores. The comparison was submitted for creator review; a “Matches”
verdict has not yet been received.
