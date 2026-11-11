# Matcap reference

For a stylized surface such as goo, a matcap maps the view-space surface normal and eye direction into a 2D
material-capture texture. It can reproduce a painted highlight cheaply, but its baked lighting follows the camera
rather than the scene lights. Compare it against the concept from several camera angles before choosing it over a
lit material. The MIT-licensed [hughsk/matcap](https://github.com/hughsk/matcap) GLSL implementation is a reference
for the lookup; check the rights of any matcap image separately before using it.
