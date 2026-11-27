const intrinsicControls = new Set(['button', 'input', 'select', 'textarea', 'dialog', 'menu']);
const controlRoles = new Set(['button', 'switch', 'slider', 'menu', 'menuitem', 'dialog']);
const controlClasses = /(?:^|[\s_-])(?:panel|sheet|menu|chip|toggle|slider)(?:$|[\s_-])/i;
const designStyle =
  /^(?:color|background(?:Color)?|border(?:.*Color|.*Radius)?|boxShadow|textShadow|backdropFilter|opacity|font(?:Size|Weight)?|lineHeight|letterSpacing|transition(?:Duration|TimingFunction)?|animation(?:Duration|TimingFunction)?)$/;

// Native controls belong inside the shared library so every screen gets the
// same semantics and states. Test fixtures are excluded by the caller.
export const glassComponentsRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      control: 'Use a shared Glass component for {{name}}.',
      style: 'Use a generated design token for {{name}}.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type === 'JSXIdentifier' && intrinsicControls.has(node.name.name))
          context.report({ node, messageId: 'control', data: { name: node.name.name } });
        if (node.name.type !== 'JSXIdentifier' || !/^[a-z]/.test(node.name.name)) return;
        for (const attr of node.attributes) {
          if (
            attr.type === 'JSXAttribute' &&
            attr.name.name === 'role' &&
            attr.value?.type === 'Literal' &&
            controlRoles.has(attr.value.value)
          )
            context.report({ node: attr, messageId: 'control', data: { name: attr.value.value } });
          if (
            attr.type === 'JSXAttribute' &&
            attr.name.name === 'className' &&
            attr.value?.type === 'Literal' &&
            typeof attr.value.value === 'string' &&
            controlClasses.test(attr.value.value)
          )
            context.report({ node: attr, messageId: 'control', data: { name: attr.value.value } });
          if (
            attr.type !== 'JSXAttribute' ||
            attr.name.name !== 'style' ||
            attr.value?.type !== 'JSXExpressionContainer'
          )
            continue;
          const expression = attr.value.expression;
          if (expression.type !== 'ObjectExpression') continue;
          for (const property of expression.properties) {
            if (property.type !== 'Property' || property.computed) continue;
            const name = property.key.type === 'Identifier' ? property.key.name : property.key.value;
            if (typeof name !== 'string' || !designStyle.test(name) || property.value.type !== 'Literal') continue;
            const value = property.value.value;
            if (
              typeof value === 'number' ||
              (typeof value === 'string' && !/^(?:var\(|inherit$|none$|normal$|0$)/.test(value.trim()))
            )
              context.report({ node: property, messageId: 'style', data: { name } });
          }
        }
      },
    };
  },
};
