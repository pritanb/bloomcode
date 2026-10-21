import { expect, it } from 'vitest';
import { detectLanguage } from '../../src/web/features/practice/detectLanguage';

it('recognises LeetCode solutions in each supported language', () => {
  const samples: Record<string, string> = {
    python: `class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        seen = {}
        return []`,
    java: `class Solution {
    public int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> seen = new HashMap<>();
        return new int[0];
    }
}`,
    cpp: `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        return {};
    }
};`,
    typescript: `function twoSum(nums: number[], target: number): number[] {
    const seen = new Map<number, number>();
    return [];
}`,
    javascript: `var twoSum = function(nums, target) {
    const seen = new Map();
    return [];
};`,
    go: `func twoSum(nums []int, target int) []int {
    seen := map[int]int{}
    return nil
}`,
  };
  for (const [language, code] of Object.entries(samples))
    expect(detectLanguage(code), language).toBe(language);
});

it('stays unsure about empty code and unsupported languages', () => {
  expect(detectLanguage('')).toBeNull();
  expect(detectLanguage('func twoSum(_ nums: [Int], _ target: Int) -> [Int] {')).toBeNull();
});
