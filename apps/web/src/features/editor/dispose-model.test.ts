import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { disposeModel } from './dispose-model';

describe('disposeModel', () => {
  it('disposes shared geometry, materials and textures once', () => {
    const texture = new Texture();
    const material = new MeshStandardMaterial({ map: texture });
    const geometry = new BoxGeometry();
    const disposeTexture = vi.spyOn(texture, 'dispose');
    const disposeMaterial = vi.spyOn(material, 'dispose');
    const disposeGeometry = vi.spyOn(geometry, 'dispose');
    const root = new Group();
    root.add(new Mesh(geometry, material), new Mesh(geometry, material));
    disposeModel(root);
    expect(disposeTexture).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
    expect(disposeGeometry).toHaveBeenCalledOnce();
  });
});
