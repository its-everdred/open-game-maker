import { resolve } from 'node:path';
import { accentForName } from './glass-accents.mjs';
const intrinsicControls = new Set(['button', 'input', 'select', 'textarea', 'dialog', 'menu']);
const controlRoles = new Set(['button', 'switch', 'slider', 'menu', 'menuitem', 'dialog']);
// These controls have accented interactive states even without a tone prop.
const fixedControlRoles = new Map([
  ['GlassSwitch', 'go'],
  ['GlassSlider', 'go'],
  ['GlassChoice', 'needs-you'],
]);
const controlClasses = /(?:^|[\s_-])(?:panel|sheet|menu|chip|toggle|slider)(?:$|[\s_-])/i;
const designStyle =
  /^(?:color|background(?:Color)?|border(?:.*Color|.*Radius)?|boxShadow|textShadow|backdropFilter|opacity|font(?:Size|Weight)?|lineHeight|letterSpacing|transition(?:Duration|TimingFunction)?|animation(?:Duration|TimingFunction)?)$/;

function rawDesignValue(node) {
  if (node.type === 'ConditionalExpression') return rawDesignValue(node.consequent) || rawDesignValue(node.alternate);
  if (node.type === 'LogicalExpression') return rawDesignValue(node.left) || rawDesignValue(node.right);
  if (node.type === 'BinaryExpression') return true;
  if (node.type === 'TemplateLiteral') {
    if (node.expressions.length) return true;
    return rawDesignValue({ type: 'Literal', value: node.quasis[0].value.cooked });
  }
  if (node.type !== 'Literal') return true;
  const value = node.value;
  return (
    typeof value === 'number' ||
    (typeof value === 'string' && !/^(?:var\(--[\w-]+\)|inherit|none|normal|0)$/.test(value.trim()))
  );
}

function hasControlClass(node) {
  if (node.type === 'Literal') return typeof node.value === 'string' && controlClasses.test(node.value);
  if (node.type === 'TemplateLiteral') return node.quasis.some((part) => controlClasses.test(part.value.cooked ?? ''));
  if (node.type === 'ConditionalExpression') return hasControlClass(node.consequent) || hasControlClass(node.alternate);
  if (node.type === 'LogicalExpression' || node.type === 'BinaryExpression')
    return hasControlClass(node.left) || hasControlClass(node.right);
  return false;
}

function hasControlRole(node) {
  if (node.type === 'Literal') return typeof node.value === 'string' && controlRoles.has(node.value);
  if (node.type === 'ConditionalExpression') return hasControlRole(node.consequent) || hasControlRole(node.alternate);
  if (node.type === 'LogicalExpression') return hasControlRole(node.left) || hasControlRole(node.right);
  return false;
}

// Native controls belong inside the shared library so every screen gets the
// same semantics and states. Test fixtures are excluded by the caller.
export const glassComponentsRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      control: 'Use a shared Glass component for {{name}}.',
      style: 'Use a generated design token for {{name}}.',
      dynamicStyle: 'Inline style properties must be statically inspectable.',
      dynamicProps: 'Spread props must be statically inspectable.',
      accents: 'Use one interactive accent per screen; found {{hues}}.',
    },
  },
  create(context) {
    const hues = new Set();
    let firstAccent;
    function collectAccent(node) {
      if (node.type === 'Literal' && typeof node.value === 'string') {
        const accent = accentForName(node.value);
        if (accent) {
          hues.add(accent);
          firstAccent ??= node;
        }
      } else if (node.type === 'ConditionalExpression') {
        collectAccent(node.consequent);
        collectAccent(node.alternate);
      } else if (node.type === 'LogicalExpression') {
        collectAccent(node.right);
      }
    }
    function checkStyleObject(expression) {
      if (expression.type === 'ConditionalExpression') {
        checkStyleObject(expression.consequent);
        checkStyleObject(expression.alternate);
        return;
      }
      if (expression.type === 'LogicalExpression' && expression.operator === '&&') {
        checkStyleObject(expression.right);
        return;
      }
      if (expression.type === 'Literal' && (expression.value === null || expression.value === false)) return;
      if (expression.type !== 'ObjectExpression') {
        context.report({ node: expression, messageId: 'dynamicStyle' });
        return;
      }
      for (const property of expression.properties) {
        if (property.type === 'SpreadElement') {
          checkStyleObject(property.argument);
          continue;
        }
        if (property.type !== 'Property') continue;
        const name =
          property.key.type === 'Literal'
            ? property.key.value
            : !property.computed && property.key.type === 'Identifier'
              ? property.key.name
              : undefined;
        if (typeof name !== 'string') {
          context.report({ node: property, messageId: 'dynamicStyle' });
          continue;
        }
        if (!designStyle.test(name)) continue;
        if (rawDesignValue(property.value)) context.report({ node: property, messageId: 'style', data: { name } });
      }
    }
    function checkSpread(expression, intrinsic) {
      if (expression.type !== 'ObjectExpression') {
        context.report({ node: expression, messageId: 'dynamicProps' });
        return;
      }
      for (const property of expression.properties) {
        if (property.type === 'SpreadElement') {
          checkSpread(property.argument, intrinsic);
          continue;
        }
        if (property.type !== 'Property') continue;
        const name =
          property.key.type === 'Literal'
            ? property.key.value
            : !property.computed && property.key.type === 'Identifier'
              ? property.key.name
              : undefined;
        if (typeof name !== 'string') {
          context.report({ node: property, messageId: 'dynamicProps' });
        } else if (name === 'style') {
          checkStyleObject(property.value);
        } else if (intrinsic && name === 'role' && hasControlRole(property.value)) {
          context.report({ node: property, messageId: 'control', data: { name } });
        } else if (intrinsic && name === 'className' && hasControlClass(property.value)) {
          context.report({ node: property, messageId: 'control', data: { name } });
        }
      }
    }
    return {
      JSXOpeningElement(node) {
        if (node.name.type === 'JSXIdentifier') {
          const role = fixedControlRoles.get(node.name.name);
          const accent = role && accentForName(role);
          if (accent) {
            hues.add(accent);
            firstAccent ??= node;
          }
        }
        if (node.name.type === 'JSXIdentifier' && /^(?:GlassButton|GlassOrb|GlassOption)$/.test(node.name.name)) {
          const tone = node.attributes.find((attr) => attr.type === 'JSXAttribute' && attr.name.name === 'tone');
          const accent = node.attributes.find((attr) => attr.type === 'JSXAttribute' && attr.name.name === 'accent');
          const toneValue = tone?.value?.type === 'Literal' ? tone.value.value : undefined;
          if (node.name.name === 'GlassButton' && toneValue === 'glassy' && !accent) {
            hues.add('green');
            firstAccent ??= tone;
          }
          for (const attr of node.attributes) {
            if (attr.type !== 'JSXAttribute' || !['tone', 'accent'].includes(attr.name.name) || !attr.value) continue;
            // GlassButton only consumes its accent prop with the glassy tone.
            if (
              node.name.name === 'GlassButton' &&
              attr.name.name === 'accent' &&
              (!tone || (toneValue && toneValue !== 'glassy'))
            )
              continue;
            collectAccent(attr.value.type === 'JSXExpressionContainer' ? attr.value.expression : attr.value);
          }
        }
        if (node.name.type === 'JSXIdentifier' && intrinsicControls.has(node.name.name))
          context.report({ node, messageId: 'control', data: { name: node.name.name } });
        const intrinsic = node.name.type === 'JSXIdentifier' && /^[a-z]/.test(node.name.name);
        for (const attr of node.attributes) {
          if (attr.type === 'JSXSpreadAttribute') {
            checkSpread(attr.argument, intrinsic);
            continue;
          }
          if (
            intrinsic &&
            attr.type === 'JSXAttribute' &&
            attr.name.name === 'role' &&
            attr.value &&
            !(
              context.filename === resolve(context.cwd, 'src/components/Dialog.tsx') &&
              attr.value.type === 'Literal' &&
              attr.value.value === 'dialog'
            ) &&
            hasControlRole(attr.value.type === 'JSXExpressionContainer' ? attr.value.expression : attr.value)
          )
            context.report({ node: attr, messageId: 'control', data: { name: 'role' } });
          if (
            intrinsic &&
            attr.type === 'JSXAttribute' &&
            attr.name.name === 'className' &&
            attr.value &&
            hasControlClass(attr.value.type === 'JSXExpressionContainer' ? attr.value.expression : attr.value)
          )
            context.report({ node: attr, messageId: 'control', data: { name: attr.value.value } });
          if (
            attr.type !== 'JSXAttribute' ||
            attr.name.name !== 'style' ||
            attr.value?.type !== 'JSXExpressionContainer'
          )
            continue;
          checkStyleObject(attr.value.expression);
        }
      },
      'Program:exit'() {
        if (hues.size > 1)
          context.report({ node: firstAccent, messageId: 'accents', data: { hues: [...hues].sort().join(', ') } });
      },
    };
  },
};
