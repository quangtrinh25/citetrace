/** Curated candidate metadata verified against arxiv.org on 2026-09-06.
 * A candidate is background information, never a proof of implementation origin. */
export interface RegistryPaper { id: string; title: string; authors: string[]; year: number; arxiv: string; url: string; metadataSource: 'registry' }
export interface ConceptRule { id: string; name: string; version: string; aliases: string[]; calls: string[]; hardNegatives: string[]; paper: RegistryPaper }
function rule(id: string, name: string, aliases: string[], calls: string[], arxiv: string, title: string, authors: string[], year: number): ConceptRule {
  return { id, name, version: '2', aliases, calls, hardNegatives: [`# ${name} is mentioned only in a comment\n`, `from unrelated import ${aliases[0]}\nvalue = ${aliases[0]}()\n`, ...(id === 'adam' ? ['class Family:\n    def adam(self): return self.children[0]\n'] : [])], paper: { id: `arxiv:${arxiv}`, arxiv, title, authors, year, url: `https://arxiv.org/abs/${arxiv}`, metadataSource: 'registry' } };
}
export const conceptRegistry: readonly ConceptRule[] = [
  rule('rmsnorm', 'RMSNorm', ['RMSNorm', 'rms_norm', 'root_mean_square_norm'], ['torch.nn.RMSNorm', 'torch.nn.functional.rms_norm'], '1910.07467', 'Root Mean Square Layer Normalization', ['Biao Zhang', 'Rico Sennrich'], 2019),
  rule('layernorm', 'LayerNorm', ['LayerNorm', 'layer_norm', 'layer_normalization'], ['torch.nn.LayerNorm', 'torch.nn.functional.layer_norm'], '1607.06450', 'Layer Normalization', ['Jimmy Lei Ba', 'Jamie Ryan Kiros', 'Geoffrey E. Hinton'], 2016),
  rule('batchnorm', 'BatchNorm', ['BatchNorm', 'BatchNorm1d', 'BatchNorm2d', 'BatchNorm3d', 'batch_norm'], ['torch.nn.BatchNorm1d', 'torch.nn.BatchNorm2d', 'torch.nn.BatchNorm3d', 'torch.nn.functional.batch_norm'], '1502.03167', 'Batch Normalization: Accelerating Deep Network Training by Reducing Internal Covariate Shift', ['Sergey Ioffe', 'Christian Szegedy'], 2015),
  rule('groupnorm', 'GroupNorm', ['GroupNorm', 'group_norm'], ['torch.nn.GroupNorm', 'torch.nn.functional.group_norm'], '1803.08494', 'Group Normalization', ['Yuxin Wu', 'Kaiming He'], 2018),
  rule('focal-loss', 'Focal Loss', ['FocalLoss', 'focal_loss', 'sigmoid_focal_loss'], ['torchvision.ops.sigmoid_focal_loss', 'torchvision.ops.focal_loss.sigmoid_focal_loss'], '1708.02002', 'Focal Loss for Dense Object Detection', ['Tsung-Yi Lin', 'Priya Goyal', 'Ross Girshick', 'Kaiming He', 'Piotr Dollár'], 2017),
  rule('adam', 'Adam', ['Adam', 'adam_optimizer'], ['torch.optim.Adam', 'torch.optim.adam.Adam'], '1412.6980', 'Adam: A Method for Stochastic Optimization', ['Diederik P. Kingma', 'Jimmy Ba'], 2014),
  rule('adamw', 'AdamW', ['AdamW'], ['torch.optim.AdamW', 'torch.optim.adamw.AdamW'], '1711.05101', 'Decoupled Weight Decay Regularization', ['Ilya Loshchilov', 'Frank Hutter'], 2017),
  rule('gelu', 'GELU', ['GELU'], ['torch.nn.GELU', 'torch.nn.functional.gelu'], '1606.08415', 'Gaussian Error Linear Units (GELUs)', ['Dan Hendrycks', 'Kevin Gimpel'], 2016),
  rule('rope', 'RoPE', ['RoPE', 'RotaryEmbedding', 'apply_rotary_pos_emb', 'apply_rotary_emb', 'rotary_pos_emb'], ['rotary_embedding_torch.RotaryEmbedding', 'rotary_embedding_torch.apply_rotary_emb'], '2104.09864', 'RoFormer: Enhanced Transformer with Rotary Position Embedding', ['Jianlin Su', 'Yu Lu', 'Shengfeng Pan', 'Ahmed Murtadha', 'Bo Wen', 'Yunfeng Liu'], 2021),
  rule('lora', 'LoRA', ['LoRA', 'LoRALayer', 'LoRALinear', 'lora_linear'], ['peft.LoraConfig', 'peft.tuners.lora.LoraConfig', 'loralib.Linear', 'loralib.Embedding', 'loralib.MergedLinear'], '2106.09685', 'LoRA: Low-Rank Adaptation of Large Language Models', ['Edward J. Hu', 'Yelong Shen', 'Phillip Wallis', 'Zeyuan Allen-Zhu', 'Yuanzhi Li', 'Shean Wang', 'Lu Wang', 'Weizhu Chen'], 2021),
];
