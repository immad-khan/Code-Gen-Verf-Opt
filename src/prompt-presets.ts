export interface PromptPreset {
  id: string;
  title: string;
  description: string;
  category: string;
  prompt: string;
}

export const PRESET_PROMPTS: PromptPreset[] = [
  {
    id: 'heap-largest',
    title: 'Largest Integers (Heap)',
    description: 'Find the largest integers from a list using the heap queue (heapq) algorithm.',
    category: 'Python · Algorithms',
    prompt: 'Write a function to find the largest integers from a given list of numbers using heap queue algorithm'
  },
  {
    id: 'domino-filling',
    title: 'Dominoes Filling (3xN)',
    description: 'Find the number of ways to fill a 3 x n board with 2 x 1 dominoes.',
    category: 'Python · Dynamic Prog',
    prompt: 'Write a function to find the number of ways to fill it with 2 x 1 dominoes for the given 3 x n board.'
  },
  {
    id: 'bit-difference',
    title: 'One-Bit Difference Checker',
    description: 'Check whether two given integers differ at exactly one bit position.',
    category: 'Python · Bitwise',
    prompt: 'Write a python function to check whether the two numbers differ at one bit position only or not.'
  },
  {
    id: 'top-k-frequent',
    title: 'Top K Frequent Integers',
    description: 'Find the top k integers that occur most frequently from given lists of sorted and distinct integers using heap queue algorithm.',
    category: 'Python · Algorithms',
    prompt: 'Write a function to find the top k integers that occur most frequently from given lists of sorted and distinct integers using heap queue algorithm'
  }
];
